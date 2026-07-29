// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Badge, Box, HStack, Text } from "@chakra-ui/react";
import {
  ALLOWED_RULE_TYPES,
  type AllowedRuleType,
  SUPPORTED_RULE_TYPES,
  type SupportedRuleType,
  safeParseSpendSpikeThresholdConfig,
} from "@ee/governance/services/activity-monitor/thresholdConfig.schema";
import type { ZodError } from "zod";

/**
 * The config the composer pre-fills for a spend_spike rule: the three keys
 * `spendSpikeThresholdConfigSchema` requires, and nothing else. A fourth key
 * here is worse than useless — unknown keys are dropped when the rule is
 * read, so the admin would tune a number that never reaches the rule.
 */
export const SPEND_SPIKE_THRESHOLD_TEMPLATE = JSON.stringify(
  {
    windowSec: 86400,
    ratioVsBaseline: 2.0,
    minBaselineUsd: 1.0,
  },
  null,
  2,
);

/**
 * How many earlier periods the spend-spike baseline averages over. Mirrors
 * `BASELINE_WINDOWS` in `spendSpikeAnomalyEvaluator.service.ts`, which is not
 * exported; this is the number the sentence below has to say.
 */
const BASELINE_PERIODS = "six";

type Summary =
  | { kind: "ok" | "unsupported"; english: string }
  | { kind: "error"; message: string };

const DURATION_UNITS = [
  { seconds: 86400, singular: "day", plural: "days" },
  { seconds: 3600, singular: "hour", plural: "hours" },
  { seconds: 60, singular: "minute", plural: "minutes" },
  { seconds: 1, singular: "second", plural: "seconds" },
] as const;

/**
 * Both halves of the comparison, phrased from one window length so they can
 * never drift apart: "the last day" against "the previous six days", "the
 * last 5 minutes" against "the previous six 5-minute periods".
 */
function describeWindow(windowSec: number): {
  current: string;
  baseline: string;
} {
  const unit =
    DURATION_UNITS.find((candidate) => windowSec >= candidate.seconds) ??
    DURATION_UNITS[DURATION_UNITS.length - 1]!;
  const count = Math.round((windowSec / unit.seconds) * 10) / 10;
  if (count === 1) {
    return {
      current: `the last ${unit.singular}`,
      baseline: `the previous ${BASELINE_PERIODS} ${unit.plural}`,
    };
  }
  return {
    current: `the last ${count} ${unit.plural}`,
    baseline: `the previous ${BASELINE_PERIODS} ${count}-${unit.singular} periods`,
  };
}

/**
 * Turn the schema's own refusal into one sentence. Going through the schema
 * rather than re-checking the fields by hand is the point: what the composer
 * calls invalid and what `anomalyRules.create` refuses are then the same set
 * by construction, so a config an admin can save never renders red.
 */
function complaintFrom(error: ZodError): string {
  const missing: string[] = [];
  const wrong: string[] = [];
  for (const issue of error.issues) {
    const field = issue.path.join(".") || "the config";
    if (issue.code === "invalid_type" && issue.received === "undefined") {
      missing.push(field);
      continue;
    }
    // The schema writes its own messages field-first ("windowSec must be a
    // positive integer"); Zod's built-ins ("Expected number, received
    // string") do not, so those get the field put back in front.
    wrong.push(
      issue.message.includes(field)
        ? issue.message
        : `${field}: ${issue.message}`,
    );
  }
  const sentences =
    missing.length > 0 ? [`Missing ${missing.join(", ")}.`] : [];
  for (const complaint of wrong) {
    sentences.push(complaint.endsWith(".") ? complaint : `${complaint}.`);
  }
  return sentences.join(" ");
}

/** Keys the admin typed that this rule type never reads — dropped on read. */
function ignoredKeys(
  typed: Record<string, unknown>,
  read: Record<string, unknown>,
): string[] {
  return Object.keys(typed).filter((key) => !(key in read));
}

/**
 * Plain-English summary of a threshold config — rendered live below the JSON
 * textarea so admins see what their rule will do before they save it.
 *
 * Returns:
 *   - { kind: "ok", english } when the rule type fires today and the config
 *     is one the create call accepts
 *   - { kind: "unsupported", english } when the rule type saves but nothing
 *     evaluates it yet — a clear "this won't fire" signal at compose time
 *   - { kind: "error", message } when the create call would refuse this —
 *     an unknown rule type, unparseable JSON, or a config the schema rejects
 */
function summariseThresholdConfig(ruleType: string, raw: string): Summary {
  const type = ruleType.trim();
  if (!ALLOWED_RULE_TYPES.includes(type as AllowedRuleType)) {
    const opener =
      type === ""
        ? "Choose a rule type."
        : `"${type}" isn't one of the rule types you can save.`;
    return {
      kind: "error",
      message: `${opener} Pick one of: ${ALLOWED_RULE_TYPES.join(", ")}.`,
    };
  }
  // Saveable but not yet evaluated: any config shape persists, because there
  // is no schema to hold it to until the rule type starts firing. Only the
  // JSON itself has to be readable.
  if (!SUPPORTED_RULE_TYPES.includes(type as SupportedRuleType)) {
    const trimmed = raw.trim();
    if (trimmed !== "" && trimmed !== "{}") {
      try {
        JSON.parse(raw);
      } catch (err) {
        return {
          kind: "error",
          message: `Invalid JSON: ${err instanceof Error ? err.message : "parse failed"}`,
        };
      }
    }
    return {
      kind: "unsupported",
      english: `${type} rules save, but nothing checks them yet. Only ${SUPPORTED_RULE_TYPES.join(", ")} fires today.`,
    };
  }
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "{}") {
    return {
      kind: "error",
      message:
        "Empty config — set windowSec, ratioVsBaseline and minBaselineUsd, or pick the rule type again to load the example.",
    };
  }
  let typed: unknown;
  try {
    typed = JSON.parse(raw);
  } catch (err) {
    return {
      kind: "error",
      message: `Invalid JSON: ${err instanceof Error ? err.message : "parse failed"}`,
    };
  }
  const result = safeParseSpendSpikeThresholdConfig(typed);
  if (!result.ok) {
    return { kind: "error", message: complaintFrom(result.error) };
  }
  const { windowSec, ratioVsBaseline, minBaselineUsd } = result.data;
  const window = describeWindow(windowSec);
  const ignored = ignoredKeys(
    typed as Record<string, unknown>,
    result.data as unknown as Record<string, unknown>,
  );
  const ignoredNote =
    ignored.length > 0
      ? ` Ignored: ${ignored.join(", ")} — a spend_spike rule doesn't read ${ignored.length === 1 ? "it" : "them"}.`
      : "";
  return {
    kind: "ok",
    english: `Fires when spend in ${window.current} reaches ${ratioVsBaseline}× the average of ${window.baseline}, as long as that average is at least $${minBaselineUsd}. Below that, spend is too small to call a spike and the rule stays quiet.${ignoredNote}`,
  };
}

export function ThresholdPreview({
  ruleType,
  raw,
}: {
  ruleType: string;
  raw: string;
}) {
  const summary = summariseThresholdConfig(ruleType, raw);
  const palette =
    summary.kind === "ok"
      ? { bg: "blue.50", border: "blue.300", fg: "blue.900", label: "Preview" }
      : summary.kind === "unsupported"
        ? {
            bg: "orange.50",
            border: "orange.300",
            fg: "orange.900",
            label: "Won't fire",
          }
        : { bg: "red.50", border: "red.300", fg: "red.900", label: "Invalid" };
  return (
    <Box
      borderWidth="1px"
      borderColor={palette.border}
      backgroundColor={palette.bg}
      padding={2}
      borderRadius="sm"
      marginTop={1}
    >
      <HStack alignItems="start" gap={2}>
        <Badge
          colorPalette={
            palette.label === "Won't fire"
              ? "orange"
              : palette.label === "Invalid"
                ? "red"
                : "blue"
          }
          size="xs"
          variant="subtle"
          data-testid="threshold-preview-verdict"
        >
          {palette.label}
        </Badge>
        <Text
          fontSize="xs"
          color={palette.fg}
          flex={1}
          data-testid="threshold-preview-text"
        >
          {summary.kind === "error" ? summary.message : summary.english}
        </Text>
      </HStack>
    </Box>
  );
}
