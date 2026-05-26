// Fetches a paper's reflowable HTML from arXiv (arxiv.org/html/<id>, which sends
// Access-Control-Allow-Origin: *), then parses it into clean, sanitized sections
// we can render single-column with our own typography. Math stays as MathML
// (browsers render it natively); figures/tables are kept and their URLs absolutized.

const HTML_URL = (id) => `https://arxiv.org/html/${id}`;

const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

// Strip anything executable/unsafe and resolve relative img/link URLs against base.
function sanitize(node, base) {
  node
    .querySelectorAll("script,style,link,meta,noscript,iframe,object,embed,form,input,button")
    .forEach((n) => n.remove());
  node.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
    }
    if (el.tagName === "IMG") {
      const src = el.getAttribute("src");
      if (src) try { el.setAttribute("src", new URL(src, base).href); } catch {}
      el.removeAttribute("srcset");
      el.setAttribute("loading", "lazy");
    }
    if (el.tagName === "A") {
      const href = el.getAttribute("href");
      if (href && !href.startsWith("#")) {
        try { el.setAttribute("href", new URL(href, base).href); } catch {}
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noreferrer");
      }
    }
  });
  return node;
}

function makeSection(rawId, title, el, base, { isAbstract = false } = {}) {
  const clone = el.cloneNode(true);
  // Drop the heading element itself — we render the title with our own styling.
  const titleSel = isAbstract ? ".ltx_title_abstract" : ".ltx_title_section";
  clone.querySelector(titleSel)?.remove();
  sanitize(clone, base);
  return {
    id: rawId,
    title,
    html: clone.innerHTML,
    text: clean(clone.textContent).slice(0, 8000), // capped for the summary prompt
  };
}

export async function fetchPaperHtml(id) {
  let res;
  try {
    res = await fetch(HTML_URL(id), { redirect: "follow" });
  } catch (e) {
    return { available: false, reason: "network" };
  }
  if (!res.ok) return { available: false, reason: res.status };

  let base = res.url || HTML_URL(id);
  if (!base.endsWith("/")) base += "/"; // so "figures/x.png" resolves into the paper dir

  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const content = doc.querySelector(".ltx_page_content") || doc.body;
  if (!content) return { available: false, reason: "parse" };

  const sections = [];
  const abstract = content.querySelector(".ltx_abstract");
  if (abstract) sections.push(makeSection("abstract", "Abstract", abstract, base, { isAbstract: true }));

  content.querySelectorAll(".ltx_section").forEach((sec, i) => {
    const titleEl = sec.querySelector(".ltx_title_section") || sec.querySelector("h2,h3");
    const title = titleEl ? clean(titleEl.textContent) : `Section ${i + 1}`;
    const s = makeSection(sec.id || `sec-${i}`, title, sec, base);
    if (s.text.length > 0) sections.push(s);
  });

  if (sections.length === 0) return { available: false, reason: "empty" };
  return { available: true, sections };
}
