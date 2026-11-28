import { Text } from "@react-email/components";
import { z } from "zod";

import { Chip, DigestFrame, FeedRow, digestCommonFields } from "./digest-parts.tsx";
import {
  alsoThisWeek,
  buttonSlots,
  CHIP_LABELS,
  digestWeekHeading,
  digestWeekPreview,
  digestWeekReason,
  digestWeekSubheading,
  digestWeekSubject,
  rowCopy,
} from "./digest-week-rows.ts";
import { InlineLink, expressive } from "./email-layout.tsx";
import { defineTemplate, renderMailTemplate } from "./registry.ts";

const { light } = expressive;

const link = z.url().describe("A direct link into LangWatch");
const count = z.number().int().nonnegative();
const positive = z.number().int().positive();
const percent = z.number().min(0).max(100);
const projectName = z.string().min(1);
const direction = z.enum(["worse", "better"]).describe("Which way the rate moved");
/** A catalogue evaluator by name, or the organisation's custom ones, whose type holds an id. */
const evaluator = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("catalogue"), name: z.string().min(1) }),
  z.object({ kind: z.literal("custom") }),
]);
export type DigestWeekEvaluator = z.infer<typeof evaluator>;

const planRow = z.object({
  kind: z.literal("plan"),
  used: count.describe("Traces this month"),
  limit: positive.describe("Traces the plan includes a month"),
  daysLeft: count.describe("Days until the month's count resets"),
  resetsOn: z.string().min(1).describe("When the count resets, e.g. Dec 1"),
  url: link.describe("Where to choose which traces to keep"),
  upgradeUrl: link,
});

const scenariosRow = z.object({
  kind: z.literal("scenarios"),
  direction,
  projectName,
  runs: positive.describe("Scenario runs this week"),
  failed: count,
  baselineFailurePercent: percent.describe("Runs-weighted, over the four weeks before"),
  url: link,
});

const evalsRow = z.object({
  kind: z.literal("evals"),
  direction,
  projectName,
  evaluator,
  checks: positive.describe("Passed or failed this week"),
  failed: count,
  baselinePassPercent: percent.describe("Checks-weighted, over the four weeks before"),
  url: link,
});

const quietRow = z.object({
  kind: z.literal("quiet"),
  projectName,
  previousTraces: positive.describe("Traces the week before; none this week"),
  url: link,
});

const setupRow = z.object({ kind: z.literal("setup"), projectName, url: link });

const codingRow = z.object({
  kind: z.literal("coding"),
  sessions: positive.describe("The reader's own coding-agent sessions this week"),
  tokens: count,
  commits: count.optional().describe("Absent when the agent reports none"),
  pullRequests: count.optional(),
  topRepository: z.object({ name: z.string().min(1), sessions: positive }).optional(),
  totalsAtLeast: z
    .boolean()
    .describe("The week held more metric series than it keeps, so each total is a floor"),
  url: link,
});

const tracesRow = z.object({
  kind: z.literal("traces"),
  projectName,
  traces: positive.describe("The busiest project's traces this week"),
  previousTraces: count.optional().describe("Absent when last week could not be read"),
  errors: count,
  costUsd: z.number().nonnegative(),
  p95Milliseconds: z.number().nonnegative(),
  topModel: z.object({ name: z.string().min(1), traces: count }).optional(),
  url: link,
});

/** Something to try that the reader's own numbers point to; a text link, never a button. */
const newRow = z.object({ kind: z.literal("new"), projectName, url: link });

const foldableRows = [
  planRow,
  scenariosRow,
  evalsRow,
  quietRow,
  setupRow,
  codingRow,
  tracesRow,
] as const;

export const digestWeekRowSchema = z.discriminatedUnion("kind", [...foldableRows, newRow]);
export type DigestWeekRow = z.infer<typeof digestWeekRowSchema>;

/** A row the cap cut; a New row is dropped, not cut, so it is never one. */
export const digestWeekFoldedRowSchema = z.discriminatedUnion("kind", foldableRows);
export type DigestWeekFoldedRow = z.infer<typeof digestWeekFoldedRowSchema>;

export const digestWeekProps = z.object({
  ...digestCommonFields,
  organizationName: z.string().min(1).nullable(),
  rows: z.array(digestWeekRowSchema).min(1).describe("Shown in this order, already capped"),
  folded: z.array(digestWeekFoldedRowSchema).describe("Cut by the cap, named in the last line"),
  steadyEvals: z
    .array(z.object({ evaluator, passRatePercent: percent }))
    .describe("Evals that ran enough and held their rate"),
  organizationTraces: z
    .object({ traces: count, projects: z.number().int().min(2) })
    .optional()
    .describe("Every visible project's traces, when more than one had any"),
  everythingUrl: link,
});

export type DigestWeekProps = z.infer<typeof digestWeekProps>;

/** Each chip's colour; it holds in both colour schemes. */
const CHIP_COLOURS: Readonly<Record<DigestWeekRow["kind"], string>> = {
  plan: "#c2410c",
  scenarios: "#c53030",
  evals: "#b7791f",
  quiet: "#4a5568",
  setup: "#15925a",
  coding: "#7c4dff",
  traces: "#2b5fd9",
  new: "#7a869a",
};

const AlsoThisWeek = (props: DigestWeekProps) => {
  const also = alsoThisWeek(props);
  return (
    <Text
      className="lw-muted"
      style={{
        margin: 0,
        padding: "12px 0 0",
        borderTop: `1px solid ${light.hairline}`,
        fontSize: "13.5px",
        lineHeight: 1.55,
        color: light.textMuted,
      }}
    >
      {(also.lead || also.folded.length > 0) && (
        <>
          <strong className="lw-text" style={{ color: light.text }}>
            {also.label}
          </strong>{" "}
        </>
      )}
      {also.lead && `${also.lead} `}
      {also.folded.map((row, index) => (
        <span key={row.href + row.label}>
          <InlineLink href={row.href}>{row.label}</InlineLink>
          {index === also.folded.length - 1 ? ". " : "; "}
        </span>
      ))}
      <InlineLink href={props.everythingUrl}>{also.everything}</InlineLink>
    </Text>
  );
};

export const DigestWeek = (props: DigestWeekProps) => {
  const copies = props.rows.map(rowCopy);
  const slots = buttonSlots(copies);

  return (
    <DigestFrame
      preview={digestWeekPreview(props)}
      heading={digestWeekHeading(props)}
      reason={digestWeekReason(props)}
      preferencesUrl={props.preferencesUrl}
    >
      <Text
        className="lw-muted"
        style={{ margin: "-8px 0 12px", fontSize: "13.5px", color: light.textMuted }}
      >
        {digestWeekSubheading(props)}
      </Text>
      <table
        width="100%"
        border={0}
        cellPadding="0"
        cellSpacing="0"
        role="presentation"
        style={{ width: "100%", borderCollapse: "collapse" }}
      >
        <tbody>
          {copies.map((copy, index) => {
            const slot = slots[index] ?? null;
            return (
              <FeedRow
                key={`${copy.kind}:${copy.title}`}
                chip={
                  <Chip
                    label={CHIP_LABELS[copy.kind]}
                    colour={CHIP_COLOURS[copy.kind]}
                    solid={copy.needsYou}
                  />
                }
                title={copy.title}
                href={copy.href}
                context={copy.context}
                {...(slot !== null && copy.button
                  ? { button: { ...copy.button, primary: slot === 0 } }
                  : {})}
                {...(copy.link ? { link: copy.link } : {})}
              />
            );
          })}
        </tbody>
      </table>
      <AlsoThisWeek {...props} />
    </DigestFrame>
  );
};

const BASE = "https://app.langwatch.ai";
const common = {
  weekLabel: "Nov 16 to 22",
  preferencesUrl: `${BASE}/settings/profile#email-preferences`,
  everythingUrl: BASE,
} as const;

/** The three organisation shapes the digest is checked against; the parity test rebuilds them. */
const thin: DigestWeekProps = {
  ...common,
  organizationName: "Oakridge Studio",
  rows: [
    { kind: "setup", projectName: "Docs helper", url: `${BASE}/docs-helper/online-evaluations` },
    {
      kind: "traces",
      projectName: "Docs helper",
      traces: 37,
      previousTraces: 12,
      errors: 2,
      costUsd: 0.41,
      p95Milliseconds: 2_600,
      topModel: { name: "gpt-5-mini", traces: 31 },
      url: `${BASE}/docs-helper/traces`,
    },
    { kind: "new", projectName: "Docs helper", url: `${BASE}/docs-helper/simulations/scenarios` },
  ],
  folded: [],
  steadyEvals: [],
};

const moderate: DigestWeekProps = {
  ...common,
  organizationName: "Harbourline",
  rows: [
    {
      kind: "scenarios",
      direction: "worse",
      projectName: "Support agent",
      runs: 48,
      failed: 9,
      baselineFailurePercent: 6,
      url: `${BASE}/support-agent/simulations/scenarios`,
    },
    {
      kind: "evals",
      direction: "worse",
      projectName: "Support agent",
      evaluator: { kind: "catalogue", name: "tone" },
      checks: 380,
      failed: 72,
      baselinePassPercent: 93,
      url: `${BASE}/support-agent/online-evaluations`,
    },
    {
      kind: "quiet",
      projectName: "Order search",
      previousTraces: 640,
      url: `${BASE}/order-search/traces`,
    },
    {
      kind: "traces",
      projectName: "Support agent",
      traces: 4_210,
      previousTraces: 3_760,
      errors: 38,
      costUsd: 41.2,
      p95Milliseconds: 3_400,
      topModel: { name: "gpt-5-mini", traces: 3_020 },
      url: `${BASE}/support-agent/traces`,
    },
    {
      kind: "new",
      projectName: "Returns helper",
      url: `${BASE}/returns-helper/simulations/scenarios`,
    },
  ],
  folded: [],
  steadyEvals: [{ evaluator: { kind: "catalogue", name: "faithfulness" }, passRatePercent: 96 }],
  organizationTraces: { traces: 4_330, projects: 2 },
};

const floodedPlan = {
  kind: "plan",
  used: 940_210,
  limit: 1_000_000,
  daysLeft: 8,
  resetsOn: "Dec 1",
  url: `${BASE}/settings/usage`,
  upgradeUrl: `${BASE}/settings/subscription`,
} as const;

const floodedScenarios = {
  kind: "scenarios",
  direction: "worse",
  projectName: "Checkout agent",
  runs: 240,
  failed: 74,
  baselineFailurePercent: 9,
  url: `${BASE}/checkout-agent/simulations/scenarios`,
} as const;

const floodedEvals = {
  kind: "evals",
  direction: "worse",
  projectName: "Checkout agent",
  evaluator: { kind: "catalogue", name: "refund policy" },
  checks: 12_600,
  failed: 1_512,
  baselinePassPercent: 98,
  url: `${BASE}/checkout-agent/online-evaluations`,
} as const;

const floodedQuiet = {
  kind: "quiet",
  projectName: "Internal search",
  previousTraces: 2_140,
  url: `${BASE}/internal-search/traces`,
} as const;

const floodedCoding = {
  kind: "coding",
  sessions: 64,
  tokens: 41_200_000,
  commits: 23,
  pullRequests: 7,
  topRepository: { name: "quillmark/checkout-service", sessions: 38 },
  totalsAtLeast: false,
  url: BASE,
} as const;

const floodedTraces = {
  kind: "traces",
  projectName: "Checkout agent",
  traces: 412_800,
  previousTraces: 378_700,
  errors: 9_870,
  costUsd: 3_912.55,
  p95Milliseconds: 6_800,
  topModel: { name: "gpt-5", traces: 251_300 },
  url: `${BASE}/checkout-agent/traces`,
} as const;

const floodedAlso: Pick<DigestWeekProps, "steadyEvals" | "organizationTraces"> = {
  steadyEvals: [
    { evaluator: { kind: "catalogue", name: "faithfulness" }, passRatePercent: 96 },
    { evaluator: { kind: "catalogue", name: "pii detection" }, passRatePercent: 99 },
    { evaluator: { kind: "catalogue", name: "faithfulness" }, passRatePercent: 96 },
  ],
  organizationTraces: { traces: 659_750, projects: 5 },
};

/** The fixtures the digest's parity test rebuilds from organisation weeks through its own rules. */
const DIGEST_WEEK_SHAPES = {
  "thin organisation, admin": thin,
  "thin organisation, member": thin,
  "moderate organisation, admin": moderate,
  "moderate organisation, member": moderate,
  "flooded organisation, admin": {
    ...common,
    organizationName: "Quillmark",
    rows: [floodedPlan, floodedScenarios, floodedEvals, floodedQuiet, floodedCoding],
    folded: [floodedTraces],
    ...floodedAlso,
  },
  "flooded organisation, member": {
    ...common,
    organizationName: "Quillmark",
    rows: [floodedScenarios, floodedEvals, floodedQuiet, floodedCoding, floodedTraces],
    folded: [],
    ...floodedAlso,
  },
} satisfies Record<string, DigestWeekProps>;

export const digestWeekTemplate = defineTemplate({
  id: "digest-week",
  title: "Weekly digest",
  sentWhen:
    "Every member's week in each organisation, when at least one row besides New has something to say.",
  schema: digestWeekProps,
  subject: digestWeekSubject,
  Component: DigestWeek,
  fixtures: {
    ...DIGEST_WEEK_SHAPES,
    "one row only": {
      ...common,
      organizationName: "Northwind Labs",
      rows: [floodedTraces],
      folded: [],
      steadyEvals: [{ evaluator: { kind: "custom" }, passRatePercent: 91 }],
    },
    "recovery only": {
      ...common,
      organizationName: "Northwind Labs",
      rows: [
        {
          kind: "scenarios",
          direction: "better",
          projectName: "Checkout agent",
          runs: 200,
          failed: 8,
          baselineFailurePercent: 19,
          url: `${BASE}/checkout-agent/simulations/scenarios`,
        },
      ],
      folded: [],
      steadyEvals: [],
    },
    "quiet only": {
      ...common,
      organizationName: "Northwind Labs",
      rows: [floodedQuiet],
      folded: [],
      steadyEvals: [],
    },
    "coding totals past the series cap": {
      ...common,
      organizationName: "Northwind Labs",
      rows: [{ ...floodedCoding, totalsAtLeast: true }],
      folded: [],
      steadyEvals: [],
    },
  },
});

/** Rendered by the digest module, which owns the envelope and its one-click unsubscribe. */
export const renderDigestWeekEmail = async (
  props: DigestWeekProps,
): Promise<{ subject: string; html: string }> => {
  const { subject, html } = await renderMailTemplate(digestWeekTemplate, props);
  return { subject, html };
};
