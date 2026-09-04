/**
 * Evaluation-run capability card (`platform_run_experiment`, `platform_run_plan`,
 * `platform_experiment_results`, `platform_experiment_status`).
 *
 * Surfaces the outcome of a run — a status line plus any pass-rate / score the
 * result reports — and links through to the run. Read-only.
 */
import { Badge, HStack, Text, VStack } from "@chakra-ui/react";
import {
  type CapabilityCardInput,
  extractPrimaryId,
  extractToolText,
  summaryLines,
} from "~/features/langy/logic/capabilities/capabilityRegistry";
import { extractPlatformUrl } from "~/utils/platformHref";
import { useCapabilityData } from "../../hooks/useCapabilityData";
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
 */
function readRun(output: unknown): {
  status: string | null;
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
      passRate: passRate ? passRate[1]!.replace(/\s+/g, "") : null,
      lines: summaryLines(output, 2),
    };
  }

  return {
    status: typeof document.status === "string" ? document.status : null,
    passRate: reportedPassRate(document),
    lines: runLines(document),
  };
}

/** Fields any run document reports about itself, whatever command printed it. */
const RUN_FIELDS = ["runId", "status", "progress", "total", "passed", "failed"];

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
function statusTone(status: string): "green" | "red" | "orange" {
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
  const { status, passRate, lines } = readRun(output);

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
            <Badge size="sm" variant="subtle" colorPalette={statusTone(status)}>
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
