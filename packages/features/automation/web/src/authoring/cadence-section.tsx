import { Box, Field, HStack, Input, NativeSelect, Text, VStack } from "@chakra-ui/react";
import {
  CADENCE_LABELS,
  GRAPH_ALERT_TIME_PERIODS,
  type GraphAlertOperator,
  type GraphAlertTimePeriod,
  type NotificationCadence,
} from "@langwatch/automation-contract";
import { useEffect, useState } from "react";
import { AutomationCadenceField } from "../cadence-field";
import { describeCron, isValidCron } from "../logic/report-schedule";
import { FacetSection, type FacetAccordionProps } from "./facet-section";
import { ReportScheduleField } from "./report-schedule-field";
import { AutomationTraceDebounceField } from "./trace-debounce-field";

export type AutomationSource = "trace" | "customGraph" | "report";

export interface AutomationGraphAlertDraft {
  seriesName: string;
  operator: GraphAlertOperator;
  threshold: number;
  timePeriod: GraphAlertTimePeriod;
}

export interface AutomationReportDraft {
  sourceKind: "traceQuery" | "customGraph" | "dashboard";
  cron: string;
  timezone: string;
}

export interface AutomationCadenceDraft {
  source: AutomationSource;
  notificationCadence: NotificationCadence;
  traceDebounceMs: number;
  graphAlert: AutomationGraphAlertDraft;
  report: AutomationReportDraft;
}

const OPERATOR_LABELS: Record<GraphAlertOperator, string> = {
  gt: "greater than",
  lt: "less than",
  gte: "greater than or equal",
  lte: "less than or equal",
  eq: "equal to",
};

const TIME_PERIOD_LABELS: Record<GraphAlertTimePeriod, string> = {
  1: "1 minute",
  5: "5 minutes",
  15: "15 minutes",
  30: "30 minutes",
  60: "1 hour",
  1440: "1 day",
};

const CADENCE_HELP: Record<AutomationSource, string> = {
  trace:
    "How often notifications go out — one per matching trace, or batched into a digest — plus how long to wait for late spans before evaluating.",
  customGraph:
    "What makes the alert fire: the watched metric crosses this threshold over the chosen window.",
  report: "When it's sent, as a recurring schedule in the timezone you pick.",
};

function cadenceIsSet(draft: AutomationCadenceDraft): boolean {
  if (draft.source === "customGraph") return Number.isFinite(draft.graphAlert.threshold);
  if (draft.source === "report") {
    return isValidCron({ cron: draft.report.cron, timezone: draft.report.timezone });
  }
  return true;
}

function cadenceSummary(draft: AutomationCadenceDraft): string {
  if (draft.source === "customGraph") {
    const { operator, threshold, timePeriod } = draft.graphAlert;
    if (!Number.isFinite(threshold)) return "Set a threshold";
    return `${OPERATOR_LABELS[operator]} ${threshold} over ${TIME_PERIOD_LABELS[timePeriod]}`;
  }
  if (draft.source === "report") {
    return cadenceIsSet(draft)
      ? describeCron(draft.report.cron, draft.report.timezone)
      : "Set a schedule";
  }
  const settle = Math.round(draft.traceDebounceMs / 1000);
  return `${CADENCE_LABELS[draft.notificationCadence]}, ${settle}s settle`;
}

/** Controlled cadence facet; state and transport remain in the app host. */
export function AutomationCadenceSection({
  draft,
  isEdit = false,
  accordion,
  onCadenceChange,
  onTraceDebounceChange,
  onGraphAlertChange,
  onReportChange,
}: {
  draft: AutomationCadenceDraft;
  isEdit?: boolean;
  accordion?: FacetAccordionProps;
  onCadenceChange: (value: NotificationCadence) => void;
  onTraceDebounceChange: (value: number) => void;
  onGraphAlertChange: (value: AutomationGraphAlertDraft) => void;
  onReportChange: (value: AutomationReportDraft) => void;
}) {
  return (
    <FacetSection
      title="Cadence"
      help={CADENCE_HELP[draft.source]}
      accordion={accordion}
      complete={cadenceIsSet(draft)}
      summary={cadenceSummary(draft)}
    >
      {draft.source === "customGraph" ? (
        <GraphCadence value={draft.graphAlert} onChange={onGraphAlertChange} />
      ) : draft.source === "report" ? (
        <ReportCadence value={draft.report} isEdit={isEdit} onChange={onReportChange} />
      ) : (
        <HStack align="start" gap={4}>
          <Box flex="1" minWidth="0">
            <AutomationCadenceField
              value={draft.notificationCadence}
              onValueChange={onCadenceChange}
            />
          </Box>
          <Box flex="1" minWidth="0">
            <AutomationTraceDebounceField
              value={draft.traceDebounceMs}
              onChange={onTraceDebounceChange}
            />
          </Box>
        </HStack>
      )}
    </FacetSection>
  );
}

function GraphCadence({
  value,
  onChange,
}: {
  value: AutomationGraphAlertDraft;
  onChange: (value: AutomationGraphAlertDraft) => void;
}) {
  const { operator, threshold, timePeriod } = value;
  const [thresholdText, setThresholdText] = useState(() =>
    Number.isFinite(threshold) ? String(threshold) : "",
  );

  useEffect(() => {
    setThresholdText(Number.isFinite(threshold) ? String(threshold) : "");
  }, [threshold]);

  const parsed = thresholdText.trim() === "" ? NaN : Number(thresholdText);
  const thresholdInvalid = !Number.isFinite(parsed);

  const updateThreshold = (raw: string) => {
    setThresholdText(raw);
    onChange({ ...value, threshold: raw.trim() === "" ? NaN : Number(raw) });
  };

  return (
    <VStack align="stretch" gap={4}>
      <HStack gap={3}>
        <Field.Root flex="1">
          <Field.Label>Operator</Field.Label>
          <NativeSelect.Root>
            <NativeSelect.Field
              value={operator}
              onChange={(event) =>
                onChange({
                  ...value,
                  operator: event.target.value as GraphAlertOperator,
                })
              }
            >
              <option value="gt">Greater than</option>
              <option value="lt">Less than</option>
              <option value="gte">Greater than or equal</option>
              <option value="lte">Less than or equal</option>
              <option value="eq">Equal to</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field.Root>
        <Field.Root flex="1" invalid={thresholdInvalid}>
          <Field.Label>Threshold</Field.Label>
          <Input
            type="number"
            step="any"
            value={thresholdText}
            onChange={(event) => updateThreshold(event.target.value)}
          />
          <Field.ErrorText>Enter a number to compare against.</Field.ErrorText>
        </Field.Root>
      </HStack>

      <Field.Root>
        <Field.Label>Time window</Field.Label>
        <NativeSelect.Root>
          <NativeSelect.Field
            value={timePeriod}
            onChange={(event) =>
              onChange({
                ...value,
                timePeriod: Number(event.target.value) as GraphAlertTimePeriod,
              })
            }
          >
            {GRAPH_ALERT_TIME_PERIODS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {TIME_PERIOD_LABELS[minutes]}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Field.Root>

      <Text textStyle="xs" color="fg.muted">
        Fires when the watched metric is {OPERATOR_LABELS[operator]}{" "}
        {Number.isFinite(parsed) ? parsed : "…"} over {TIME_PERIOD_LABELS[timePeriod]}.
      </Text>
    </VStack>
  );
}

function ReportCadence({
  value,
  isEdit,
  onChange,
}: {
  value: AutomationReportDraft;
  isEdit: boolean;
  onChange: (value: AutomationReportDraft) => void;
}) {
  return (
    <ReportScheduleField
      cron={value.cron}
      timezone={value.timezone}
      isEdit={isEdit}
      onChange={(next) => onChange({ ...value, ...next })}
    />
  );
}
