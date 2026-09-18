/**
 * Evaluation-run capability card (`platform_run_experiment`, `platform_run_plan`,
 * `platform_experiment_results`, `platform_experiment_status`).
 *
 * Surfaces the outcome of a run — a status line plus any pass-rate / score the
 * result reports — and links through to the run. Read-only.
 */
import { Badge, HStack, Text, VStack } from "@chakra-ui/react";
import { extractPlatformUrl } from "~/utils/platformHref";
import { useCapabilityData } from "../../hooks/useCapabilityData";
import {
  type CapabilityCardInput,
  extractPrimaryId,
  extractToolText,
  summaryLines,
} from "./capabilityRegistry";
import { LangyCapabilityCard } from "./LangyCapabilityCard";

/**
 * A run reports its own state in fields; the rest of the payload is DATA.
 *
 * This used to read the badge out of the payload text with a word match, so
 * `experiment results --filter failed` — which prints the failing rows, with
 * the word "failed" in every one of them — wore a red "failed" badge on a call
 * that succeeded. The same text pass sliced the card's body off the top of the
 * pretty-printed JSON, so the reader got `{` and `"dataset": [`.
 *
 * A document that reports a run is read structurally: the status is a field or
 * there is no badge, and the lines are counted rather than sliced. Anything
 * else (an MCP tool's prose) keeps the text reading it was written for.
 *
 * The CLI's run commands (`scenario run`, `test-suite run`, `run-plan run`)
 * answer one document: an `outcome` and, once waited for, `tallies` over the
 * batch and the per-run `results`. The run's state is the batch's, read off
 * those two fields; a row's verdict under `results` is never the badge. The
 * suite row once wore the first row's "FAILED" beside a page reading two of
 * three passed.
 */
function readRun(output: unknown): {
  status: string | null;
  tone: BadgeTone | null;
  passRate: string | null;
  lines: string[];
} {
  const document = runDocument(output);
  if (!document) {
    const text = extractToolText(output);
    const status = text.match(
      /\b(completed|running|failed|queued|passed|finished)\b/i,
    );
    const passRate = text.match(/([\d.]+\s*%)\s*(?:pass|passed|pass rate)?/i);
    return {
      status: status ? status[1]! : null,
      tone: null,
      passRate: passRate ? passRate[1]!.replace(/\s+/g, "") : null,
      lines: summaryLines(output, 2),
    };
  }

  const batch = batchRunOf(document);
  if (batch) return batch;

  return {
    status: typeof document.status === "string" ? document.status : null,
    tone: null,
    passRate: reportedPassRate(document),
    lines: runLines(document),
  };
}

/** Fields any run document reports about itself, whatever command printed it. */
const RUN_FIELDS = [
  "runId",
  "status",
  "progress",
  "total",
  "passed",
  "failed",
  "outcome",
  "tallies",
];

type BadgeTone = "green" | "red" | "orange";

/** The batch's tallies, as the CLI reports them once it waited for the run. */
type BatchTallies = {
  total: number;
  completed: number;
  passed: number;
  failed: number;
};

function talliesOf(value: unknown): BatchTallies | null {
  if (!value || typeof value !== "object") return null;
  const { total, completed, passed, failed } = value as Record<string, unknown>;
  if (
    typeof total !== "number" ||
    typeof passed !== "number" ||
    typeof failed !== "number"
  ) {
    return null;
  }
  return {
    total,
    completed: typeof completed === "number" ? completed : passed + failed,
    passed,
    failed,
  };
}

type BatchRun = {
  status: string;
  tone: BadgeTone;
  passRate: string | null;
  lines: string[];
};

/**
 * The CLI's batch run document, read as the page reads the run: the state is
 * whether the batch answered, the rate and the counts come from the tallies.
 * A run that failed is a finding, not an error, so the badge turns orange,
 * never red, and the counts say how many.
 */
function batchRunOf(document: Record<string, unknown>): BatchRun | null {
  const outcome = document.outcome;
  if (typeof outcome !== "string") return null;
  const tallies = talliesOf(document.tallies);
  if (!tallies) return unansweredBatch(outcome, document.jobCount);
  return talliedBatch(outcome, tallies);
}

/** A batch the CLI did not wait for, or could not read: no tallies, only the jobs it scheduled. */
function unansweredBatch(outcome: string, jobs: unknown): BatchRun {
  return {
    status: outcome === "scheduled" ? "scheduled" : outcome.replace("_", " "),
    tone: "orange",
    passRate: null,
    lines:
      typeof jobs === "number"
        ? [`${jobs} ${jobs === 1 ? "run" : "runs"} scheduled`]
        : [],
  };
}

/** The states a wait can end in short of the batch answering. */
const WAIT_STATES: Record<string, string> = {
  timeout: "timed out",
  poll_failure: "unknown",
};

function talliedBatch(outcome: string, tallies: BatchTallies): BatchRun {
  const answered = tallies.completed >= tallies.total;
  const status = WAIT_STATES[outcome] ?? (answered ? "completed" : "running");
  const clean = status === "completed" && tallies.failed === 0;
  const settled = tallies.passed + tallies.failed;
  return {
    status,
    tone: clean ? "green" : "orange",
    passRate:
      settled > 0 ? `${Math.round((tallies.passed / settled) * 100)}%` : null,
    lines: [talliesLine(tallies)],
  };
}

function talliesLine(tallies: BatchTallies): string {
  const passed = `${tallies.passed} of ${tallies.total} passed`;
  return tallies.failed > 0 ? `${passed}, ${tallies.failed} failed` : passed;
}

function runDocument(output: unknown): Record<string, unknown> | null {
  const value = typeof output === "string" ? parseJson(output) : output;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const document = value as Record<string, unknown>;
  return RUN_FIELDS.some((field) => document[field] !== undefined)
    ? document
    : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Only a rate the document states, never one inferred from row counts. */
function reportedPassRate(document: Record<string, unknown>): string | null {
  const { passed, failed } = document;
  if (typeof passed !== "number" || typeof failed !== "number") return null;
  const total = passed + failed;
  return total > 0 ? `${Math.round((passed / total) * 100)}%` : null;
}

function runLines(document: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const { progress, total, evaluations } = document;
  if (typeof progress === "number" && typeof total === "number") {
    lines.push(`${progress} of ${total} rows`);
  }
  if (Array.isArray(evaluations)) {
    const scored = evaluations.filter(
      (item) => typeof (item as { passed?: unknown }).passed === "boolean",
    );
    if (scored.length > 0) {
      const passed = scored.filter(
        (item) => (item as { passed: boolean }).passed,
      ).length;
      lines.push(`${passed} of ${scored.length} evaluations passed`);
    }
  }
  return lines;
}

/** A finished run reads as finished; only a real failure reads as red. */
function statusTone(status: string): BadgeTone {
  const word = status.toLowerCase();
  if (word === "failed" || word === "error") return "red";
  if (["completed", "finished", "success", "passed"].includes(word)) {
    return "green";
  }
  return "orange";
}

export function LangyEvalRunCard({
  descriptor,
  input,
  output,
  digest,
  projectSlug,
}: CapabilityCardInput) {
  const id = digest?.primaryId ?? extractPrimaryId(input, output);
  const { status, tone, passRate, lines } = readRun(output);

  // Opportunistic: when the run references an experiment the viewer can read,
  // title the card by the experiment's CURRENT name. Anything else (no
  // hydrator, id not found) quietly keeps the parsed title below.
  const hydration = useCapabilityData({ digest: digest ?? null, maxRows: 1 });
  const hydratedName = hydration.rows[0]?.primary;

  return (
    <LangyCapabilityCard
      tone="read"
      surface={descriptor.surface}
      overline={descriptor.overline}
      title={
        <HStack gap={2} align="center">
          <Text textStyle="sm" fontWeight="640" color="fg">
            {hydratedName ??
              digest?.name ??
              (id ? `Run ${id.slice(0, 10)}` : "Run")}
          </Text>
          {status ? (
            <Badge
              size="sm"
              variant="subtle"
              colorPalette={tone ?? statusTone(status)}
            >
              {status}
            </Badge>
          ) : null}
          {passRate ? (
            <Text
              textStyle="xs"
              fontFamily="mono"
              fontWeight="700"
              color="green.fg"
            >
              {passRate}
            </Text>
          ) : null}
        </HStack>
      }
      projectSlug={projectSlug}
      resourceId={id}
      platformUrl={extractPlatformUrl(output)}
    >
      {lines.length > 0 ? (
        <VStack align="stretch" gap={0.5}>
          {lines.map((line, i) => (
            <Text key={i} textStyle="xs" color="fg.muted" lineHeight="1.45">
              {line}
            </Text>
          ))}
        </VStack>
      ) : null}
    </LangyCapabilityCard>
  );
}
