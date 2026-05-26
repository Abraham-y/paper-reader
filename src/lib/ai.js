// AI section summaries via OpenRouter (OpenAI-compatible, CORS-enabled, so it
// works from this static site). The API key lives only in the browser's
// localStorage and calls go straight from the device to OpenRouter — fine for a
// personal app; just don't share the key.

const AI_STORE = "dailydrop:ai";
const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct";

export function loadAI() {
  try {
    return { model: DEFAULT_MODEL, apiKey: "", ...JSON.parse(localStorage.getItem(AI_STORE) || "{}") };
  } catch {
    return { model: DEFAULT_MODEL, apiKey: "" };
  }
}

export function saveAI(cfg) {
  try { localStorage.setItem(AI_STORE, JSON.stringify(cfg)); } catch {}
}

// Cache summaries per paper+section so we don't re-pay on every revisit.
const sumKey = (paperId, sectionId) => `dailydrop:sum:${paperId}:${sectionId}`;
export function cachedSummary(paperId, sectionId) {
  try { return localStorage.getItem(sumKey(paperId, sectionId)) || null; } catch { return null; }
}
function cacheSummary(paperId, sectionId, text) {
  try { localStorage.setItem(sumKey(paperId, sectionId), text); } catch {}
}

export async function summarizeSection({ paperId, section }, cfg) {
  if (!cfg?.apiKey) throw new Error("Add an OpenRouter API key in settings to turn on summaries.");

  const cached = cachedSummary(paperId, section.id);
  if (cached) return cached;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://abrahamyeung.com/paper-reader/",
      "X-Title": "Daily Paper Drop",
    },
    body: JSON.stringify({
      model: cfg.model || DEFAULT_MODEL,
      max_tokens: 220,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You help someone reading an academic paper on their phone while walking. Given one section, reply with 2–3 plain, concrete sentences: what it says and why it matters. No preamble, no markdown headings, no bullet lists. Keep it tight.",
        },
        { role: "user", content: `Section: ${section.title}\n\n${section.text}` },
      ],
    }),
  });

  if (!res.ok) {
    let msg = `OpenRouter error ${res.status}`;
    try {
      const e = await res.json();
      msg = e?.error?.message || msg;
    } catch {}
    throw new Error(msg);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty summary from the model.");
  cacheSummary(paperId, section.id, text);
  return text;
}
