import React, { useEffect, useRef, useState, useCallback } from "react";
import { ArrowLeft, ArrowUpRight, Minus, Plus, Check, Loader2, Sparkles, FileText } from "lucide-react";
import { fetchPaperHtml } from "./lib/paperHtml";
import { summarizeSection, cachedSummary } from "./lib/ai";

const FONT_STORE = "dailydrop:font";
const isArxivId = (id) => id && !id.startsWith("custom-");

// One full-text reader: fetches arxiv.org/html, reflows it single-column with
// adjustable font, and auto-generates a short digest below each section as you
// scroll past it (when an OpenRouter key is set).
export default function Reader({ paper, palette, aiCfg, onExit, onLog }) {
  const P = palette;
  const [status, setStatus] = useState("loading"); // loading | ready | unavailable | error
  const [sections, setSections] = useState([]);
  const [summaries, setSummaries] = useState({}); // id -> { state, text }
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem(FONT_STORE)) || 19);
  const sentinelRefs = useRef({}); // sectionId -> end-of-section element
  const runningRef = useRef({}); // sectionId -> true while a request is in flight

  useEffect(() => {
    localStorage.setItem(FONT_STORE, String(fontSize));
  }, [fontSize]);

  // Fetch + parse on mount / when the paper changes.
  useEffect(() => {
    let alive = true;
    setStatus("loading");
    setSections([]);
    setSummaries({});
    if (!isArxivId(paper.id)) {
      setStatus("unavailable");
      return;
    }
    fetchPaperHtml(paper.id)
      .then((r) => {
        if (!alive) return;
        if (!r.available) {
          setStatus("unavailable");
          return;
        }
        setSections(r.sections);
        // Prefill any summaries we've already generated before.
        const pre = {};
        for (const s of r.sections) {
          const c = cachedSummary(paper.id, s.id);
          if (c) pre[s.id] = { state: "done", text: c };
        }
        setSummaries(pre);
        setStatus("ready");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, [paper.id]);

  const runSummary = useCallback(
    async (section) => {
      if (!aiCfg?.apiKey) return; // summaries off until a key is set
      if (runningRef.current[section.id]) return;
      if (summaries[section.id]?.state === "done") return;
      runningRef.current[section.id] = true;
      setSummaries((m) => ({ ...m, [section.id]: { state: "loading" } }));
      try {
        const text = await summarizeSection({ paperId: paper.id, section }, aiCfg);
        setSummaries((m) => ({ ...m, [section.id]: { state: "done", text } }));
      } catch (e) {
        setSummaries((m) => ({ ...m, [section.id]: { state: "error", text: e.message } }));
      } finally {
        runningRef.current[section.id] = false;
      }
    },
    [aiCfg, paper.id, summaries]
  );

  // Auto-trigger a section's summary once its end scrolls into view.
  useEffect(() => {
    if (status !== "ready" || !aiCfg?.apiKey) return;
    const byId = Object.fromEntries(sections.map((s) => [s.id, s]));
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const id = e.target.dataset.sectionEnd;
            if (id && byId[id]) runSummary(byId[id]);
          }
        }
      },
      { rootMargin: "0px 0px -35% 0px" } // fire a bit before the very bottom
    );
    Object.values(sentinelRefs.current).forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, [status, sections, aiCfg, runSummary]);

  const headerBar = (
    <div
      className="flex items-center justify-between mb-4 sticky top-0 z-10"
      style={{ background: P.paper, borderBottom: `1px solid ${P.line}`, paddingBottom: 10, paddingTop: 4 }}
    >
      <button onClick={onExit} style={{ color: P.ink, fontFamily: "JetBrains Mono, monospace", fontSize: 12 }} className="flex items-center gap-1">
        <ArrowLeft size={15} /> back
      </button>
      <div className="flex items-center gap-2">
        <button onClick={() => setFontSize((s) => Math.max(15, s - 1))} style={{ border: `1px solid ${P.line}`, width: 28, height: 28, color: P.ink }} className="rounded-sm flex items-center justify-center" title="smaller text">
          <Minus size={13} />
        </button>
        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: P.inkSoft, width: 18, textAlign: "center" }}>{fontSize}</span>
        <button onClick={() => setFontSize((s) => Math.min(28, s + 1))} style={{ border: `1px solid ${P.line}`, width: 28, height: 28, color: P.ink }} className="rounded-sm flex items-center justify-center" title="larger text">
          <Plus size={13} />
        </button>
      </div>
    </div>
  );

  return (
    <div>
      {headerBar}

      <h1 style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 28, lineHeight: 1.15 }}>{paper.title}</h1>
      <div style={{ color: P.inkSoft, fontSize: 13.5, fontFamily: "JetBrains Mono, monospace" }} className="mt-1 mb-2">
        {paper.authors} · {paper.year}
      </div>
      {!aiCfg?.apiKey && (
        <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11.5, color: P.gold }} className="mb-4 flex items-center gap-1.5">
          <Sparkles size={12} /> add an OpenRouter key in “manage queue” to get section digests
        </div>
      )}

      {status === "loading" && (
        <div style={{ color: P.inkSoft, fontFamily: "JetBrains Mono, monospace", fontSize: 13 }} className="flex items-center gap-2 py-10">
          <Loader2 size={15} className="animate-spin" /> fetching the reflowed text…
        </div>
      )}

      {(status === "unavailable" || status === "error") && (
        <div style={{ background: P.card, border: `1px dashed ${P.line}` }} className="rounded-sm p-5 mt-2">
          <p style={{ fontSize: 14.5, lineHeight: 1.5 }}>
            {status === "error"
              ? "Couldn’t load the reflowed text."
              : "arXiv doesn’t publish a reflowed HTML version of this paper."}
            {isArxivId(paper.id) ? " You can still read it mobile-friendly via ar5iv, or open the PDF:" : ""}
          </p>
          {isArxivId(paper.id) && (
            <div className="flex flex-col gap-2 mt-3">
              <a href={`https://ar5iv.org/html/${paper.id}`} target="_blank" rel="noreferrer"
                style={{ background: P.accent, color: "#fff", fontFamily: "JetBrains Mono, monospace", fontSize: 12, letterSpacing: 0.5 }}
                className="py-2.5 rounded-sm flex items-center justify-center gap-1.5 uppercase">
                Open reflowed view (ar5iv) <ArrowUpRight size={14} />
              </a>
              <a href={`https://arxiv.org/pdf/${paper.id}`} target="_blank" rel="noreferrer"
                style={{ border: `1px solid ${P.line}`, color: P.ink, fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}
                className="py-2.5 rounded-sm flex items-center justify-center gap-1.5">
                <FileText size={14} /> Open PDF
              </a>
            </div>
          )}
        </div>
      )}

      {status === "ready" && (
        <div className="paper-html" style={{ fontFamily: "Spectral, Georgia, serif", fontSize, color: P.ink, marginTop: 8 }}>
          {sections.map((s) => {
            const sum = summaries[s.id];
            return (
              <section key={s.id} className="mt-6">
                <h2 style={{ fontFamily: "Fraunces, serif", fontWeight: 600, fontSize: "1.35em", lineHeight: 1.2, marginBottom: 6 }}>{s.title}</h2>
                <div dangerouslySetInnerHTML={{ __html: s.html }} />
                {/* sentinel marking the end of this section */}
                <div ref={(el) => (sentinelRefs.current[s.id] = el)} data-section-end={s.id} style={{ height: 1 }} />
                {(sum || aiCfg?.apiKey) && (
                  <div style={{ background: P.accentSoft, borderLeft: `3px solid ${P.accent}`, borderRadius: 4 }} className="px-4 py-3 mt-3">
                    <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 9.5, letterSpacing: 1.5, color: P.accent }} className="uppercase mb-1 flex items-center gap-1">
                      <Sparkles size={11} /> digest
                    </div>
                    {(!sum || sum.state === "loading") && (
                      <div style={{ color: P.inkSoft, fontFamily: "JetBrains Mono, monospace", fontSize: 12 }} className="flex items-center gap-2">
                        <Loader2 size={13} className="animate-spin" /> summarizing…
                      </div>
                    )}
                    {sum?.state === "done" && <p style={{ fontSize: "0.82em", lineHeight: 1.5, color: P.ink }}>{sum.text}</p>}
                    {sum?.state === "error" && (
                      <p style={{ fontSize: 12, color: P.accent, fontFamily: "JetBrains Mono, monospace" }}>{sum.text}</p>
                    )}
                  </div>
                )}
              </section>
            );
          })}

          <div style={{ borderTop: `2px solid ${P.ink}`, marginTop: 30, paddingTop: 16 }} className="flex flex-col gap-2 mb-10">
            <a href={`https://arxiv.org/abs/${paper.id}`} target="_blank" rel="noreferrer"
              style={{ color: P.accent, fontFamily: "JetBrains Mono, monospace", fontSize: 12 }} className="inline-flex items-center gap-1">
              open on arXiv <ArrowUpRight size={13} />
            </a>
            {onLog && (
              <button onClick={onLog}
                style={{ background: P.ink, color: P.paper, fontFamily: "JetBrains Mono, monospace", letterSpacing: 1 }}
                className="py-3.5 rounded-sm flex items-center justify-center gap-2 text-sm uppercase mt-1">
                <Check size={16} /> Done — log this read
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
