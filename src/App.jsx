import React, { useState, useEffect, useRef } from "react";
import { Flame, Timer, ArrowUpRight, Check, Copy, RotateCcw, BookOpen, Plus, Settings2, Sparkles, ListChecks, Loader2 } from "lucide-react";

/*
  DAILY PAPER DROP
  ------------------------------------------------------------------
  Attacks three problems at once:
    • Discovery        -> papers handed to you, ranked by the subfields you flag as interesting
    • Activation energy -> "5-minute mode": abstract + key points + a running timer, not 12 pages
    • Accountability    -> a streak that only counts once you hit your daily goal, + a buddy share line

  Storage: everything (streak / queue / added papers / interests / log) is saved to the
  browser's localStorage, so it persists per-device with no backend.

  Adding a paper: type an arXiv ID and the title/authors/abstract/year autofill live from
  the arXiv API (routed through a CORS proxy, since arXiv sends no CORS header). Fields you
  fill in by hand always win over the fetched values.
*/

const PALETTE = {
  paper: "#f4f1ea",
  ink: "#1c1a17",
  inkSoft: "#5a544b",
  accent: "#c1432a",
  accentSoft: "#e8d6cf",
  line: "#d8d2c4",
  gold: "#9a7b3f",
  card: "#fffdf7",
};

const SEED_QUEUE = [
  {
    id: "2304.03442",
    title: "Generative Agents: Interactive Simulacra of Human Behavior",
    authors: "Park, O'Brien, Cai, Morris, Liang, Bernstein",
    year: 2023,
    field: "Multi-agent simulation",
    summary:
      "LM-backed agents remember, reflect, and plan inside a sandbox town, producing believable emergent social behavior from individual memory streams.",
    points: [
      "A memory stream + retrieval + reflection loop is what makes the agents feel coherent over long horizons.",
      "Emergent coordination (a party, a date) arises bottom-up, no one scripts the group behavior.",
      "Ablating reflection or planning visibly degrades believability, which is the strongest evidence.",
    ],
    why: "Direct ancestor of your knowledge-constrained multi-agent society idea. Read it for the memory architecture, then ask what changes when agents have bounded knowledge.",
  },
  {
    id: "physics/0004057",
    title: "The Information Bottleneck Method",
    authors: "Tishby, Pereira, Bialek",
    year: 2000,
    field: "Information theory",
    summary:
      "Frames learning as compressing input X into a representation T that keeps only the information relevant to a target Y, trading compression against prediction.",
    points: [
      "The core object is min I(X;T) − β I(T;Y): squeeze X, but pay to keep what predicts Y.",
      "β is the knob that slides between maximal compression and maximal relevance.",
      "It gives a principled, target-aware notion of a 'minimal sufficient' representation.",
    ],
    why: "The formal backbone of your 'do constrained models build more abstract representations?' hypothesis. This is the language to write that claim in.",
  },
  {
    id: "1807.03748",
    title: "Representation Learning with Contrastive Predictive Coding",
    authors: "van den Oord, Li, Vinyals",
    year: 2018,
    field: "Representation learning",
    summary:
      "Learns representations by predicting future latents in a contrastive setup, with the InfoNCE objective lower-bounding mutual information.",
    points: [
      "InfoNCE turns 'predict the future' into a tractable MI lower bound you can actually optimize.",
      "The learned latents transfer across speech, vision, and text with minimal task-specific machinery.",
      "Negative sampling quality is doing more work than it first appears.",
    ],
    why: "Bridges the InfoBottleneck paper to practice: how the abstract MI story turns into a trainable objective.",
  },
  {
    id: "2305.18290",
    title: "Direct Preference Optimization: Your Language Model is Secretly a Reward Model",
    authors: "Rafailov, Sharma, Mitchell, Manning, Ermon, Finn",
    year: 2023,
    field: "Post-training / RL",
    summary:
      "Skips explicit reward modeling and RL by reparameterizing preference learning into a simple classification-style loss on the policy itself.",
    points: [
      "The reward is implicit in the policy, so you optimize preferences directly with a closed-form loss.",
      "No separate reward model and no sampling loop means far less to tune than PPO-style RLHF.",
      "The derivation reuses the same KL-regularized objective RLHF targets, just solved differently.",
    ],
    why: "Core to the post-training thread you keep circling. Read the derivation, not just the result.",
  },
  {
    id: "2206.07682",
    title: "Emergent Abilities of Large Language Models",
    authors: "Wei, Tay, Bommasani, et al.",
    year: 2022,
    field: "Scaling / capabilities",
    summary:
      "Catalogs capabilities that appear abruptly past a scale threshold rather than improving smoothly, and argues they're hard to predict from small models.",
    points: [
      "Several abilities show sharp, near-discontinuous jumps with scale rather than smooth curves.",
      "Whether 'emergence' is real or a metric artifact became a live debate downstream of this.",
      "Implication: small-model behavior may not extrapolate, which cuts against tidy scaling stories.",
    ],
    why: "A useful foil for your small-LM hypothesis. If abilities emerge with scale, what do constrained models gain instead?",
  },
  {
    id: "1503.02406",
    title: "Deep Learning and the Information Bottleneck Principle",
    authors: "Tishby, Zaslavsky",
    year: 2015,
    field: "Information theory",
    summary:
      "Argues deep nets can be analyzed as a Markov chain of representations that trade off compression and relevance layer by layer.",
    points: [
      "Each layer is framed as a point on the information plane (compression vs relevance).",
      "Suggests an information-theoretic optimality criterion for what a layer should keep.",
      "Set up the later, contested 'compression phase' empirical claims.",
    ],
    why: "The bridge between the original IB method and modern deep nets. Pairs naturally with the 2000 paper.",
  },
];

const todayKey = () => new Date().toISOString().slice(0, 10);
const yesterdayKey = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const STORE_KEY = "dailydrop:v2";

const FRESH = {
  streak: 0,
  longest: 0,
  lastCompletedDate: null,
  todayDate: null,
  todayCount: 0,
  readIds: [],
  userPapers: [],
  interests: [],
  goal: 3,
  log: [],
};

// ---- arXiv lookup ----------------------------------------------------------
// arXiv's API sends no Access-Control-Allow-Origin header, so a browser can't
// read it cross-origin. We tunnel the request through a CORS proxy and parse
// the Atom XML it returns. Falls back to a second proxy if the first is down.
const ARXIV = (id) =>
  `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`;
const PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

// Accepts a raw arXiv id, an arxiv.org URL, or an "arXiv:xxxx" string.
const normalizeArxivId = (raw) =>
  raw
    .trim()
    .replace(/^arxiv:/i, "")
    .replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//i, "")
    .replace(/v\d+$/i, "")
    .replace(/\.pdf$/i, "")
    .trim();

async function fetchArxiv(rawId) {
  const id = normalizeArxivId(rawId);
  if (!id) return null;
  const target = ARXIV(id);
  let xml = null;
  for (const proxy of PROXIES) {
    try {
      const res = await fetch(proxy(target));
      if (!res.ok) continue;
      xml = await res.text();
      if (xml && xml.includes("<entry")) break;
    } catch (e) {
      /* try next proxy */
    }
  }
  if (!xml) throw new Error("Could not reach arXiv. Fill the fields in by hand.");

  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const entry = doc.querySelector("entry");
  if (!entry) throw new Error("No paper found for that arXiv ID.");
  const text = (sel) => entry.querySelector(sel)?.textContent?.trim() || "";

  const title = text("title").replace(/\s+/g, " ");
  const summary = text("summary").replace(/\s+/g, " ");
  const published = text("published");
  const year = published ? new Date(published).getFullYear() : new Date().getFullYear();
  const authors = Array.from(entry.querySelectorAll("author > name"))
    .map((n) => n.textContent.trim())
    .filter(Boolean);
  // Primary subject category, e.g. "cs.LG", as a rough default "field".
  const category =
    entry.querySelector("[term]")?.getAttribute("term") || "";

  return { id, title, summary, year, authors, category };
}

export default function DailyPaperDrop() {
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState(FRESH);
  const [mode, setMode] = useState("card"); // card | reading | done
  const [seconds, setSeconds] = useState(0);
  const [takeaway, setTakeaway] = useState("");
  const [critique, setCritique] = useState("");
  const [copied, setCopied] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [listTab, setListTab] = useState("deck"); // deck | read — the reading-list panel
  const [draft, setDraft] = useState({ id: "", title: "", authors: "", field: "", summary: "" });
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState("");
  const tickRef = useRef(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = { ...FRESH, ...JSON.parse(raw) };
        setState(parsed);
        const doneToday = parsed.todayDate === todayKey() ? parsed.todayCount : 0;
        if (doneToday >= parsed.goal) setMode("done");
      }
    } catch (e) {}
    setLoaded(true);
  }, []);

  const persist = (next) => {
    setState(next);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); }
    catch (e) { console.error("save failed", e); }
  };

  useEffect(() => {
    if (mode === "reading") {
      tickRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      return () => clearInterval(tickRef.current);
    }
  }, [mode]);

  // ---- derived ----
  const allPapers = [...SEED_QUEUE, ...state.userPapers];
  const allFields = [...new Set(allPapers.map((p) => p.field).filter(Boolean))];
  const unread = allPapers.filter((p) => !state.readIds.includes(p.id));
  const ranked = state.interests.length
    ? [...unread].sort(
        (a, b) =>
          (state.interests.includes(b.field) ? 1 : 0) - (state.interests.includes(a.field) ? 1 : 0)
      )
    : unread;

  const doneToday = state.todayDate === todayKey() ? state.todayCount : 0;
  const remainingToday = Math.max(0, state.goal - doneToday);
  const lineup = ranked.slice(0, remainingToday); // still to read today
  const paper = lineup[0];
  const upNext = lineup.slice(1); // rest of today's goal, after the current paper
  const laterQueue = ranked.slice(remainingToday); // queued beyond today's goal

  const TARGET = 300;
  const pct = Math.min(100, (seconds / TARGET) * 100);
  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  // ---- actions ----
  const startReading = () => { setSeconds(0); setMode("reading"); };

  const logIt = () => {
    if (!takeaway.trim() || !paper) return;
    const today = todayKey();
    const isNewDay = state.todayDate !== today;
    const newCount = (isNewDay ? 0 : state.todayCount) + 1;
    let { streak, longest, lastCompletedDate } = state;
    const justCompleted = newCount >= state.goal && (isNewDay ? 0 : state.todayCount) < state.goal;
    if (justCompleted) {
      streak = lastCompletedDate === yesterdayKey() ? state.streak + 1 : 1;
      longest = Math.max(state.longest, streak);
      lastCompletedDate = today;
    }
    const next = {
      ...state,
      todayDate: today,
      todayCount: newCount,
      readIds: [...state.readIds, paper.id],
      streak, longest, lastCompletedDate,
      log: [{ date: today, title: paper.title, takeaway: takeaway.trim(), critique: critique.trim() }, ...state.log].slice(0, 50),
    };
    persist(next);
    setTakeaway(""); setCritique(""); setSeconds(0);
    setMode(newCount >= state.goal ? "done" : "card");
  };

  const toggleInterest = (f) => {
    const has = state.interests.includes(f);
    persist({ ...state, interests: has ? state.interests.filter((x) => x !== f) : [...state.interests, f] });
  };

  const setGoal = (g) => persist({ ...state, goal: Math.max(1, Math.min(10, g)) });

  // Pull title/authors/abstract/year from arXiv and prefill the draft.
  const lookupArxiv = async () => {
    if (!draft.id.trim()) return;
    setFetching(true);
    setFetchMsg("");
    try {
      const m = await fetchArxiv(draft.id);
      if (!m) return;
      setDraft((d) => ({
        id: m.id,
        title: d.title.trim() || m.title,
        authors: d.authors.trim() || m.authors.join(", "),
        field: d.field.trim() || m.category,
        summary: d.summary.trim() || m.summary,
      }));
      setFetchMsg(`✓ Loaded "${m.title.slice(0, 48)}${m.title.length > 48 ? "…" : ""}"`);
    } catch (e) {
      setFetchMsg(e.message || "Lookup failed.");
    } finally {
      setFetching(false);
    }
  };

  const addPaper = () => {
    if (!draft.title.trim()) return;
    const id = normalizeArxivId(draft.id) || `custom-${Date.now()}`;
    const p = {
      id,
      title: draft.title.trim(),
      authors: draft.authors.trim() || "Unknown",
      year: new Date().getFullYear(),
      field: draft.field.trim() || "Uncategorized",
      summary: draft.summary.trim() || "No summary yet.",
      points: [],
      why: "Added by you.",
    };
    persist({ ...state, userPapers: [...state.userPapers, p] });
    setDraft({ id: "", title: "", authors: "", field: "", summary: "" });
    setFetchMsg("");
  };

  const shareLine = () => {
    const today = state.log.filter((e) => e.date === todayKey());
    const titles = today.map((e) => `• ${e.title}`).join("\n");
    return `📚 Day ${state.streak} of my paper streak — hit ${doneToday}/${state.goal} today.\n${titles}\nTop takeaway: ${today[0]?.takeaway || ""}\nYour turn.`;
  };
  const copyShare = async () => {
    try { await navigator.clipboard.writeText(shareLine()); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch (e) {}
  };

  const advanceDay = () => {
    // pretend yesterday's goal was met so the streak can continue on "today"
    persist({ ...state, lastCompletedDate: yesterdayKey(), todayDate: yesterdayKey(), todayCount: state.goal });
    setMode("card");
  };
  const hardReset = () => { persist(FRESH); setMode("card"); setShowManage(false); };

  if (!loaded) {
    return (
      <div style={{ background: PALETTE.paper, color: PALETTE.inkSoft, fontFamily: "JetBrains Mono, monospace" }}
           className="min-h-screen flex items-center justify-center text-sm">
        loading your shelf…
      </div>
    );
  }

  const matched = paper && state.interests.includes(paper.field);

  return (
    <div
      style={{
        background: PALETTE.paper, color: PALETTE.ink, fontFamily: "Spectral, Georgia, serif",
        backgroundImage:
          "radial-gradient(circle at 18% 12%, rgba(193,67,42,0.04), transparent 40%), radial-gradient(circle at 85% 88%, rgba(154,123,63,0.05), transparent 45%)",
      }}
      className="min-h-screen w-full flex justify-center px-5 py-10"
    >
      <div className="w-full" style={{ maxWidth: 560 }}>
        {/* Masthead */}
        <div className="flex items-end justify-between mb-4" style={{ borderBottom: `2px solid ${PALETTE.ink}`, paddingBottom: 14 }}>
          <div>
            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, letterSpacing: 3, color: PALETTE.accent }}>
              {state.goal} PAPERS · DAILY
            </div>
            <h1 style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 38, lineHeight: 1, marginTop: 4 }}>
              The Daily Drop
            </h1>
          </div>
          <div className="flex items-center gap-2" title="current streak">
            <Flame size={22} color={state.streak > 0 ? PALETTE.accent : PALETTE.line} fill={state.streak > 0 ? PALETTE.accent : "none"} />
            <span style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 30 }}>{state.streak}</span>
          </div>
        </div>

        {/* Daily progress dots */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: state.goal }).map((_, i) => (
              <div key={i} style={{
                width: 22, height: 6, borderRadius: 3,
                background: i < doneToday ? PALETTE.accent : PALETTE.line,
              }} />
            ))}
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: PALETTE.inkSoft, marginLeft: 6 }}>
              {doneToday}/{state.goal} today
            </span>
          </div>
          <button onClick={() => setShowManage((s) => !s)}
            style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: PALETTE.inkSoft, border: `1px solid ${PALETTE.line}` }}
            className="px-2 py-1 rounded-sm flex items-center gap-1">
            <Settings2 size={11} /> manage queue
          </button>
        </div>

        {/* MANAGE PANEL */}
        {showManage && (
          <div style={{ background: PALETTE.card, border: `1px solid ${PALETTE.line}` }} className="rounded-sm p-4 mb-6">
            {/* Goal */}
            <div className="flex items-center justify-between mb-4">
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, letterSpacing: 1, color: PALETTE.ink }}>papers per day</span>
              <div className="flex items-center gap-3">
                <button onClick={() => setGoal(state.goal - 1)} style={{ border: `1px solid ${PALETTE.line}`, width: 26, height: 26 }} className="rounded-sm">−</button>
                <span style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 20, width: 18, textAlign: "center" }}>{state.goal}</span>
                <button onClick={() => setGoal(state.goal + 1)} style={{ border: `1px solid ${PALETTE.line}`, width: 26, height: 26 }} className="rounded-sm">+</button>
              </div>
            </div>

            {/* Interests */}
            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, letterSpacing: 1.5, color: PALETTE.gold }} className="uppercase mb-2 flex items-center gap-1">
              <Sparkles size={11} /> interests — tap to prioritize
            </div>
            <div className="flex flex-wrap gap-2 mb-5">
              {allFields.map((f) => {
                const on = state.interests.includes(f);
                return (
                  <button key={f} onClick={() => toggleInterest(f)}
                    style={{
                      fontFamily: "JetBrains Mono, monospace", fontSize: 11,
                      background: on ? PALETTE.accent : "transparent",
                      color: on ? "#fff" : PALETTE.inkSoft,
                      border: `1px solid ${on ? PALETTE.accent : PALETTE.line}`,
                    }}
                    className="px-2.5 py-1 rounded-sm">
                    {f}
                  </button>
                );
              })}
            </div>

            {/* Add paper */}
            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, letterSpacing: 1.5, color: PALETTE.gold }} className="uppercase mb-2 flex items-center gap-1">
              <Plus size={11} /> add a paper
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} placeholder="arXiv ID (e.g. 2310.06825)"
                  style={inputStyle} className="rounded-sm px-2.5 py-2 outline-none" />
                <button onClick={lookupArxiv} disabled={!draft.id.trim() || fetching}
                  style={{ border: `1px solid ${PALETTE.line}`, fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: PALETTE.ink, whiteSpace: "nowrap", opacity: !draft.id.trim() || fetching ? 0.5 : 1 }}
                  className="px-3 rounded-sm flex items-center gap-1.5">
                  {fetching ? <Loader2 size={13} className="animate-spin" /> : <ArrowUpRight size={13} />} fetch
                </button>
              </div>
              <input value={draft.field} onChange={(e) => setDraft({ ...draft, field: e.target.value })} placeholder="field"
                style={inputStyle} className="rounded-sm px-2.5 py-2 outline-none" />
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="title (required)"
                style={inputStyle} className="rounded-sm px-2.5 py-2 outline-none" />
              <input value={draft.authors} onChange={(e) => setDraft({ ...draft, authors: e.target.value })} placeholder="authors"
                style={inputStyle} className="rounded-sm px-2.5 py-2 outline-none" />
              <textarea value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} placeholder="one-line summary" rows={2}
                style={inputStyle} className="rounded-sm px-2.5 py-2 outline-none" />
              <button onClick={addPaper} disabled={!draft.title.trim()}
                style={{ background: draft.title.trim() ? PALETTE.ink : PALETTE.line, color: draft.title.trim() ? PALETTE.paper : PALETTE.inkSoft, fontFamily: "JetBrains Mono, monospace", letterSpacing: 1 }}
                className="py-2.5 rounded-sm text-xs uppercase flex items-center justify-center gap-2">
                <Plus size={13} /> add to queue
              </button>
              {fetchMsg && (
                <p style={{ fontSize: 11.5, color: fetchMsg.startsWith("✓") ? PALETTE.gold : PALETTE.accent, fontFamily: "JetBrains Mono, monospace" }}>
                  {fetchMsg}
                </p>
              )}
              <p style={{ fontSize: 11.5, color: PALETTE.inkSoft, fontFamily: "JetBrains Mono, monospace" }}>
                Paste an arXiv ID and hit fetch to autofill the rest.
              </p>
            </div>

            <div style={{ borderTop: `1px solid ${PALETTE.line}`, marginTop: 14, paddingTop: 10, fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: PALETTE.inkSoft }} className="flex items-center gap-1">
              <ListChecks size={12} /> {unread.length} unread in queue · {allPapers.length} total
            </div>
          </div>
        )}

        {/* CARD MODE */}
        {mode === "card" && (
          <>
            {paper ? (
              <div>
                <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, letterSpacing: 2, color: PALETTE.inkSoft, marginBottom: 10 }}>
                  NEXT UP · {todayKey()}
                </div>
                <div style={{ background: PALETTE.card, border: `1px solid ${PALETTE.line}`, boxShadow: "6px 7px 0 rgba(28,26,23,0.07)" }} className="rounded-sm p-6">
                  <div className="flex items-center justify-between mb-3">
                    <span style={{ background: PALETTE.accentSoft, color: PALETTE.accent, fontFamily: "JetBrains Mono, monospace", fontSize: 10, letterSpacing: 1.5 }}
                      className="inline-block px-2 py-1 rounded-sm uppercase">
                      {paper.field}
                    </span>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: matched ? PALETTE.accent : PALETTE.inkSoft }}>
                      {matched ? "★ matches your interests" : state.interests.length ? "queue order" : "next in queue"}
                    </span>
                  </div>
                  <h2 style={{ fontFamily: "Fraunces, serif", fontWeight: 600, fontSize: 25, lineHeight: 1.18 }}>{paper.title}</h2>
                  <div style={{ color: PALETTE.inkSoft, fontSize: 14 }} className="mt-2">
                    {paper.authors} · {paper.year} · arXiv:{paper.id}
                  </div>
                  <div style={{ borderTop: `1px dashed ${PALETTE.line}`, marginTop: 16, paddingTop: 14 }}>
                    <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, letterSpacing: 1.5, color: PALETTE.gold }} className="uppercase mb-1">
                      Why it surfaced
                    </div>
                    <p style={{ fontSize: 14.5, lineHeight: 1.5 }}>{paper.why}</p>
                  </div>
                </div>

                <button onClick={startReading}
                  style={{ background: PALETTE.accent, color: "#fff", fontFamily: "JetBrains Mono, monospace", letterSpacing: 1 }}
                  className="w-full mt-5 py-4 rounded-sm flex items-center justify-center gap-2 text-sm uppercase">
                  <Timer size={16} /> Start 5-minute read
                </button>
              </div>
            ) : (
              <div style={{ background: PALETTE.card, border: `1px dashed ${PALETTE.line}` }} className="rounded-sm p-8 text-center">
                {doneToday >= state.goal ? (
                  <p style={{ fontSize: 16 }}>You've hit today's {state.goal}. Come back tomorrow.</p>
                ) : (
                  <>
                    <p style={{ fontSize: 16 }}>Your queue is empty.</p>
                    <button onClick={() => setShowManage(true)} style={{ color: PALETTE.accent, fontFamily: "JetBrains Mono, monospace", fontSize: 13 }} className="mt-2 underline">
                      add some papers
                    </button>
                  </>
                )}
              </div>
            )}

            {/* READING LIST — what's coming up + what you've finished */}
            {(unread.length > 0 || state.log.length > 0) && (
              <div className="mt-6">
                <div className="flex gap-2 mb-3">
                  {[
                    { key: "deck", label: `on deck · ${upNext.length + laterQueue.length}` },
                    { key: "read", label: `read · ${state.log.length}` },
                  ].map((t) => {
                    const on = listTab === t.key;
                    return (
                      <button key={t.key} onClick={() => setListTab(t.key)}
                        style={{
                          fontFamily: "JetBrains Mono, monospace", fontSize: 11, letterSpacing: 0.5,
                          background: on ? PALETTE.ink : "transparent",
                          color: on ? PALETTE.paper : PALETTE.inkSoft,
                          border: `1px solid ${on ? PALETTE.ink : PALETTE.line}`,
                        }}
                        className="px-3 py-1.5 rounded-sm uppercase">
                        {t.label}
                      </button>
                    );
                  })}
                </div>

                {listTab === "deck" ? (
                  upNext.length + laterQueue.length === 0 ? (
                    <p style={{ fontSize: 13.5, color: PALETTE.inkSoft, fontFamily: "JetBrains Mono, monospace" }}>
                      Nothing else on deck. Add papers from “manage queue.”
                    </p>
                  ) : (
                    <>
                      {upNext.length > 0 && (
                        <>
                          <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, letterSpacing: 1.5, color: PALETTE.gold }} className="uppercase mb-2">
                            still today
                          </div>
                          {upNext.map((p) => (
                            <div key={p.id} style={{ borderLeft: `2px solid ${PALETTE.accent}`, paddingLeft: 10 }} className="mb-2.5">
                              <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.2 }}>
                                {p.title}{state.interests.includes(p.field) ? " ★" : ""}
                              </div>
                              <div style={{ fontSize: 11.5, color: PALETTE.inkSoft, fontFamily: "JetBrains Mono, monospace" }}>{p.field}</div>
                            </div>
                          ))}
                        </>
                      )}
                      {laterQueue.length > 0 && (
                        <>
                          <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, letterSpacing: 1.5, color: PALETTE.inkSoft }} className="uppercase mb-2 mt-3">
                            coming up
                          </div>
                          {laterQueue.slice(0, 12).map((p) => (
                            <div key={p.id} style={{ borderLeft: `2px solid ${PALETTE.line}`, paddingLeft: 10 }} className="mb-2.5">
                              <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.2 }}>
                                {p.title}{state.interests.includes(p.field) ? " ★" : ""}
                              </div>
                              <div style={{ fontSize: 11.5, color: PALETTE.inkSoft, fontFamily: "JetBrains Mono, monospace" }}>{p.field}</div>
                            </div>
                          ))}
                          {laterQueue.length > 12 && (
                            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: PALETTE.inkSoft }} className="mt-1">
                              +{laterQueue.length - 12} more in queue
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )
                ) : state.log.length === 0 ? (
                  <p style={{ fontSize: 13.5, color: PALETTE.inkSoft, fontFamily: "JetBrains Mono, monospace" }}>
                    Nothing read yet. Your finished papers and takeaways land here.
                  </p>
                ) : (
                  state.log.map((e, i) => (
                    <div key={i} style={{ borderLeft: `2px solid ${PALETTE.accentSoft}`, paddingLeft: 12 }} className="mb-2.5">
                      <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{e.title}</div>
                      {e.takeaway && (
                        <div style={{ fontSize: 13, color: PALETTE.inkSoft, lineHeight: 1.35 }} className="mt-0.5">{e.takeaway}</div>
                      )}
                      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: PALETTE.line }}>{e.date}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}

        {/* READING MODE */}
        {mode === "reading" && paper && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 24, color: seconds > TARGET ? PALETTE.accent : PALETTE.ink }}>{mmss}</div>
              <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: PALETTE.inkSoft }}>
                {seconds > TARGET ? "over — wrap it up" : "target 05:00"}
              </div>
            </div>
            <div style={{ height: 4, background: PALETTE.line }} className="rounded-full mb-6 overflow-hidden">
              <div style={{ width: `${pct}%`, height: "100%", background: PALETTE.accent, transition: "width 1s linear" }} />
            </div>

            <h2 style={{ fontFamily: "Fraunces, serif", fontWeight: 600, fontSize: 22, lineHeight: 1.2 }}>{paper.title}</h2>
            <a href={`https://arxiv.org/abs/${paper.id}`} target="_blank" rel="noreferrer"
              style={{ color: PALETTE.accent, fontFamily: "JetBrains Mono, monospace", fontSize: 12 }} className="inline-flex items-center gap-1 mt-1">
              open on arXiv <ArrowUpRight size={13} />
            </a>

            <p style={{ fontSize: 15.5, lineHeight: 1.55, marginTop: 16 }}>{paper.summary}</p>

            {paper.points && paper.points.length > 0 && (
              <>
                <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, letterSpacing: 1.5, color: PALETTE.gold }} className="uppercase mt-5 mb-2">
                  Three things to take away
                </div>
                <ol className="flex flex-col gap-2.5">
                  {paper.points.map((p, i) => (
                    <li key={i} className="flex gap-3" style={{ fontSize: 14.5, lineHeight: 1.45 }}>
                      <span style={{ fontFamily: "Fraunces, serif", fontWeight: 900, color: PALETTE.accent, fontSize: 18, lineHeight: 1 }}>{i + 1}</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}

            <div style={{ borderTop: `2px solid ${PALETTE.ink}`, marginTop: 22, paddingTop: 16 }}>
              <label style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, letterSpacing: 1, color: PALETTE.ink }} className="block mb-1">
                One sentence: what's the core idea?
              </label>
              <textarea value={takeaway} onChange={(e) => setTakeaway(e.target.value)} rows={2} placeholder="In your own words…"
                style={{ ...inputStyle, fontFamily: "Spectral, serif", fontSize: 15 }} className="w-full rounded-sm p-3 outline-none" />
              <label style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, letterSpacing: 1, color: PALETTE.inkSoft }} className="block mb-1 mt-3">
                Optional: weakest assumption / your gripe?
              </label>
              <input value={critique} onChange={(e) => setCritique(e.target.value)} placeholder="The critique muscle is the one worth training."
                style={{ ...inputStyle, fontFamily: "Spectral, serif", fontSize: 15 }} className="w-full rounded-sm p-3 outline-none" />
              <button onClick={logIt} disabled={!takeaway.trim()}
                style={{ background: takeaway.trim() ? PALETTE.ink : PALETTE.line, color: takeaway.trim() ? PALETTE.paper : PALETTE.inkSoft, fontFamily: "JetBrains Mono, monospace", letterSpacing: 1 }}
                className="w-full mt-4 py-3.5 rounded-sm flex items-center justify-center gap-2 text-sm uppercase">
                <Check size={16} /> Log it ({doneToday + 1}/{state.goal})
              </button>
            </div>
          </div>
        )}

        {/* DONE MODE */}
        {mode === "done" && (
          <div>
            <div className="flex flex-col items-center text-center py-4">
              <Flame size={48} color={PALETTE.accent} fill={PALETTE.accent} />
              <div style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 52, lineHeight: 1 }} className="mt-2">{state.streak}</div>
              <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, letterSpacing: 1.5, color: PALETTE.inkSoft }} className="uppercase">
                day streak · best {state.longest}
              </div>
              <p style={{ fontSize: 15, maxWidth: 360 }} className="mt-4">
                All {state.goal} done today. The next drop unlocks tomorrow, that gap is the point.
              </p>
            </div>

            <div style={{ background: PALETTE.card, border: `1px solid ${PALETTE.line}` }} className="rounded-sm p-4 mt-2">
              <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, letterSpacing: 1.5, color: PALETTE.gold }} className="uppercase mb-2">
                send your paper buddy
              </div>
              <pre style={{ fontFamily: "Spectral, serif", fontSize: 13.5, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{shareLine()}</pre>
              <button onClick={copyShare}
                style={{ background: PALETTE.accent, color: "#fff", fontFamily: "JetBrains Mono, monospace", letterSpacing: 1 }}
                className="w-full mt-3 py-2.5 rounded-sm flex items-center justify-center gap-2 text-xs uppercase">
                {copied ? <><Check size={14} /> copied</> : <><Copy size={14} /> copy to clipboard</>}
              </button>
            </div>

            {state.log.length > 0 && (
              <div className="mt-6">
                <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, letterSpacing: 1.5, color: PALETTE.inkSoft }} className="uppercase mb-2 flex items-center gap-2">
                  <BookOpen size={12} /> your shelf
                </div>
                <div className="flex flex-col gap-2.5">
                  {state.log.slice(0, 6).map((e, i) => (
                    <div key={i} style={{ borderLeft: `2px solid ${PALETTE.accentSoft}`, paddingLeft: 12 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{e.title}</div>
                      <div style={{ fontSize: 13, color: PALETTE.inkSoft, lineHeight: 1.35 }} className="mt-0.5">{e.takeaway}</div>
                      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: PALETTE.line }}>{e.date}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Dev controls */}
        <div style={{ borderTop: `1px solid ${PALETTE.line}`, marginTop: 30, paddingTop: 12 }} className="flex items-center justify-between">
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: PALETTE.line }}>demo controls</span>
          <div className="flex gap-2">
            <button onClick={advanceDay} style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: PALETTE.inkSoft, border: `1px solid ${PALETTE.line}` }} className="px-2 py-1 rounded-sm">
              simulate next day
            </button>
            <button onClick={hardReset} style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: PALETTE.accent, border: `1px solid ${PALETTE.accentSoft}` }} className="px-2 py-1 rounded-sm flex items-center gap-1">
              <RotateCcw size={10} /> reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  background: "#fffdf7",
  border: "1px solid #d8d2c4",
  color: "#1c1a17",
  fontFamily: "JetBrains Mono, monospace",
  fontSize: 13,
  width: "100%",
};
