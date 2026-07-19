import { useEffect, useState } from "react";
import type {
  BriefingData,
  BriefingReceipt,
  ScenarioBar,
  StatusCell,
} from "../types";

/**
 * DEV-ONLY briefing fixtures.
 *
 * The live briefing only renders what the project's real data supports, which
 * makes the fuller states hard to see on a quiet dev project. These mocks let
 * the switcher at the top of the home preview every state, so the layout can be
 * tuned against real variety. They are gated behind
 * `process.env.NODE_ENV === "development"` exactly like the home-view override,
 * and never resolve in production — not one fake number reaches a real user.
 *
 * Rather than hand-write each state, the set is GENERATED from the dimensions
 * that actually vary the card — scenario health, which cases need a look, and
 * whether Langy drafted a fix — so the switcher covers the whole matrix
 * (30-plus permutations) instead of a lucky handful.
 */

export interface BriefingMock {
  key: string;
  label: string;
  /** Coarse group for the switcher's sectioning. */
  group: string;
  data: BriefingData;
  statusCells: StatusCell[];
}

// ── Dimensions ───────────────────────────────────────────────────────────────

type ScenarioKey =
  | "none"
  | "traces"
  | "passing"
  | "mixed"
  | "failing"
  | "empty";

interface ScenarioShape {
  label: string;
  headline: string;
  pills?: { label: string }[];
  scenariosLabel?: string;
  bars?: ScenarioBar[];
  judge?: BriefingData["judge"];
  cells: StatusCell[];
  sessionHref?: string;
}

const bar = (
  id: string,
  label: string,
  status: ScenarioBar["status"],
  fillPct: number,
): ScenarioBar => ({
  id,
  label,
  status,
  fillPct,
  statLabel: status === "pass" ? "pass" : "failing",
});

const VANITY_CELLS: StatusCell[] = [
  { label: "p50 latency", value: "4.3s", tone: "vanity" },
  { label: "Cost / 24h", value: "$0.0257", tone: "vanity" },
  { label: "Traces · threads", value: "15 · 5", tone: "vanity" },
];

const SCENARIOS: Record<ScenarioKey, ScenarioShape> = {
  none: {
    label: "No scenarios",
    headline: "Here's where you left off, and what's moved since.",
    cells: [],
  },
  empty: {
    label: "Brand-new",
    headline:
      "Your project is quiet. Send a trace and I'll start watching for what changes.",
    cells: [],
  },
  traces: {
    // A busy project with NO scenarios still has plenty to say — this is the
    // "1 million traces, lots to show" state, not a dead empty screen.
    label: "Traces, no scenarios",
    headline:
      "50 traces since yesterday. A couple worth a look, the rest healthy.",
    cells: [
      { label: "Traces", value: "50", tone: "neutral" },
      { label: "Errors", value: "2", tone: "bad" },
      { label: "Crash-free", value: "5 days", tone: "good" },
      { label: "p50 latency", value: "8.4s", tone: "vanity" },
      { label: "Cost / 24h", value: "$0.166", tone: "vanity" },
      { label: "Tokens", value: "252.7k", tone: "vanity" },
    ],
  },
  passing: {
    label: "All passing",
    headline: "All 32 scenarios passing. Nothing needs you right now.",
    pills: [{ label: "3 scenario sets" }],
    scenariosLabel: "Last run · 32 concurrent",
    bars: [
      bar("a", "refund · within policy", "pass", 98),
      bar("b", "refund · outside policy", "pass", 96),
      bar("c", "partial refund · negotiation", "pass", 94),
    ],
    judge: { pass: 32, regressions: 0, note: "rubric audited" },
    sessionHref: "#",
    cells: [
      { label: "Pass rate", value: "100%", tone: "good", link: "#" },
      { label: "Regressions", value: "0", tone: "good" },
      { label: "Failing evals", value: "0", tone: "good" },
      ...VANITY_CELLS,
    ],
  },
  mixed: {
    label: "Mostly passing",
    headline: "28 of 32 scenarios passing. A few need a look.",
    pills: [
      { label: "simulator · UserSimulatorAgent" },
      { label: "32 scenarios · DE / FR / NL" },
      { label: "rubric · 4 criteria" },
    ],
    scenariosLabel: "Last run · 32 concurrent · 6 to 9 turns each",
    bars: [
      bar("a", "refund · within policy", "pass", 97),
      bar("b", "refund · outside policy", "pass", 94),
      bar("c", "angry escalation (DE)", "fail", 100),
      bar("d", "partial refund · negotiation", "pass", 92),
    ],
    judge: { pass: 28, regressions: 4, note: "rubric audited" },
    sessionHref: "#",
    cells: [
      { label: "Pass rate", value: "87.5%", tone: "good", link: "#" },
      { label: "Regressions", value: "4", tone: "bad" },
      { label: "Failing evals", value: "4", tone: "bad" },
      ...VANITY_CELLS,
    ],
  },
  failing: {
    label: "Several failing",
    headline: "5 of 18 scenarios failing after the latest deploy.",
    pills: [{ label: "2 scenario sets" }],
    scenariosLabel: "Last run · 18 concurrent",
    bars: [
      bar("a", "checkout · happy path", "pass", 95),
      bar("b", "checkout · declined card", "fail", 100),
      bar("c", "address · ambiguous", "fail", 100),
      bar("d", "refund · partial", "pass", 90),
    ],
    judge: { pass: 13, regressions: 5, note: "rubric audited" },
    sessionHref: "#",
    cells: [
      { label: "Pass rate", value: "72%", tone: "bad", link: "#" },
      { label: "Regressions", value: "5", tone: "bad" },
      { label: "Failing evals", value: "5", tone: "bad" },
      ...VANITY_CELLS,
    ],
  },
};

type ReceiptsKey =
  | "none"
  | "errors"
  | "latency"
  | "shared"
  | "repeated"
  | "full";

const mockEvidence = (query: string, label: string) => ({
  link: { label: "Open traces", href: `#${encodeURIComponent(query)}` },
  context: { id: query, label, query },
  askPrompt: `Investigate ${label}. Separate evidence from hypotheses.`,
});

const RECEIPTS: Record<ReceiptsKey, BriefingReceipt[] | undefined> = {
  none: undefined,
  errors: [
    {
      id: "errors",
      severity: "error",
      subject: "New error shape",
      detail: "“Provider rate limit” on 4 traces.",
      metric: { text: "new", tone: "up" },
      ...mockEvidence(
        'errorMessage:"Provider rate limit"',
        "New error shape: Provider rate limit",
      ),
    },
  ],
  latency: [
    {
      id: "latency-regression",
      severity: "attention",
      subject: "Latency regressed",
      detail: "p50 is 38% slower than the prior 30 days.",
      metric: { text: "8.4s", tone: "up" },
      ...mockEvidence("duration:>8400", "Latency regression: p50 8.4s"),
    },
  ],
  shared: [
    {
      id: "shared-refund-agent",
      severity: "attention",
      subject: "Shared error signal",
      detail:
        "6 errored traces share “refund-agent”. Correlation, not a confirmed cause.",
      ...mockEvidence(
        'status:error AND traceName:"refund-agent"',
        "Shared error signal: refund-agent",
      ),
    },
  ],
  repeated: [
    {
      id: "repeated-timeout",
      severity: "error",
      subject: "Repeated error shape",
      detail: "“Upstream request timed out” on 7 traces.",
      ...mockEvidence(
        'errorMessage:"Upstream request timed out"',
        "Repeated error shape: Upstream request timed out",
      ),
    },
  ],
  full: [
    {
      id: "errors",
      severity: "error",
      subject: "New error shape",
      detail: "“Provider rate limit” on 4 traces.",
      metric: { text: "new", tone: "up" },
      ...mockEvidence(
        'errorMessage:"Provider rate limit"',
        "New error shape: Provider rate limit",
      ),
    },
    {
      id: "shared-refund-agent",
      severity: "attention",
      subject: "Shared error signal",
      detail:
        "6 errored traces share “refund-agent”. Correlation, not a confirmed cause.",
      ...mockEvidence(
        'status:error AND traceName:"refund-agent"',
        "Shared error signal: refund-agent",
      ),
    },
    {
      id: "latency-regression",
      severity: "attention",
      subject: "Latency regressed",
      detail: "p50 is 38% slower than the prior 30 days.",
      metric: { text: "8.4s", tone: "up" },
      ...mockEvidence("duration:>8400", "Latency regression: p50 8.4s"),
    },
  ],
};

const DRAFTED_PR: BriefingData["draftedPr"] = {
  title: "fix: tighten refund-policy prompt for DE escalations",
  meta: "drafted by Langy · 4 failing scenarios attached",
  added: 12,
  removed: 4,
  href: "#",
};

const ASK_HINTS: Record<ScenarioKey, string | undefined> = {
  none: undefined,
  empty: undefined,
  traces: '"what are my slowest traces?"',
  passing: '"anything worth watching this week?"',
  mixed: '"why did DE start failing?"',
  failing: '"which checkout scenarios broke?"',
};

// ── Generate the matrix ──────────────────────────────────────────────────────

const SCEN_ORDER: ScenarioKey[] = [
  "mixed",
  "failing",
  "traces",
  "passing",
  "none",
  "empty",
];
const RECEIPT_ORDER: ReceiptsKey[] = [
  "full",
  "errors",
  "latency",
  "shared",
  "repeated",
  "none",
];

function buildMocks(): BriefingMock[] {
  const mocks: BriefingMock[] = [];
  for (const scenKey of SCEN_ORDER) {
    const scen = SCENARIOS[scenKey];
    for (const rKey of RECEIPT_ORDER) {
      const receipts = RECEIPTS[rKey];
      // A brand-new / no-scenario project with no receipts is the same calm
      // card twice; keep just the one.
      if ((scenKey === "none" || scenKey === "empty") && rKey !== "none") {
        // Allow receipts on "none" (there ARE traces, just no scenarios) but
        // not on "empty" (nothing at all).
        if (scenKey === "empty") continue;
      }
      for (const withPr of [true, false]) {
        // A drafted PR only makes sense when something failed.
        if (withPr && scenKey !== "mixed" && scenKey !== "failing") continue;

        const key = `${scenKey}_${rKey}${withPr ? "_pr" : ""}`;
        const labelBits = [scen.label];
        if (rKey !== "none") labelBits.push(`+ ${rKey}`);
        if (withPr) labelBits.push("+ fix");

        mocks.push({
          key,
          group: scen.label,
          label: labelBits.join(" "),
          data: {
            since: "since yesterday",
            loop: scen.bars ? "median goal to PR · 14 min" : undefined,
            headline: scen.headline,
            receiptsLabel: receipts ? "Needs a look" : undefined,
            receipts,
            pills: scen.pills,
            scenariosLabel: scen.scenariosLabel,
            bars: scen.bars,
            barsMore:
              scenKey === "mixed"
                ? "28 more. Faithfulness on angry escalation (DE) dropped 0.91 to 0.62 after this morning's prompt change."
                : undefined,
            judge: scen.judge,
            draftedPr: withPr ? DRAFTED_PR : undefined,
            askHint: ASK_HINTS[scenKey],
            sessionHref: scen.sessionHref,
          },
          statusCells: scen.cells,
        });
      }
    }
  }
  return mocks;
}

export const BRIEFING_MOCKS: BriefingMock[] = buildMocks();

export function getBriefingMock(key: string): BriefingMock | undefined {
  return BRIEFING_MOCKS.find((m) => m.key === key);
}

// ── Dev override (mirrors useHomeViewOverride) ───────────────────────────────

const STORAGE_KEY = "langwatch:dev:briefing-mock";

export const isBriefingMockAvailable = () =>
  process.env.NODE_ENV === "development";

// Same-tab fan-out: `storage` events only fire in OTHER tabs, so writes notify
// hook instances in this tab by hand (the switcher and the page each hold one).
const listeners = new Set<() => void>();

function readBriefingMock(): string | null {
  if (typeof window === "undefined" || !isBriefingMockAvailable()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && getBriefingMock(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function setBriefingMock(key: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (key === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, key);
    }
  } catch {
    // Best-effort dev tool.
  }
  listeners.forEach((cb) => cb());
}

export function useBriefingMock(): string | null {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    setKey(readBriefingMock());
    const onChange = () => setKey(readBriefingMock());
    listeners.add(onChange);
    window.addEventListener("storage", onChange);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return key;
}
