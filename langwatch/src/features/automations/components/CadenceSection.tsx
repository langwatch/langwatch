import {
  Box,
  Field,
  HStack,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { CADENCE_LABELS } from "@langwatch/automations/cadences";
import {
  GRAPH_ALERT_TIME_PERIODS,
  type GraphAlertOperator,
  type GraphAlertTimePeriod,
} from "~/server/app-layer/automations/graph-alert.builder";
import {
  type AutomationDraft,
  cadenceIsSet,
  OPERATOR_LABELS,
  TIME_PERIOD_LABELS,
} from "../logic/draftReducer";
import { describeCron } from "../logic/reportSchedule";
import { useAutomationStore } from "../state/automationStore";
import { useDraft } from "../state/selectors";
import { CadenceField } from "./CadenceField";
import { FacetSection, type FacetAccordionProps } from "./FacetSection";
import { ReportScheduleField } from "./ReportScheduleField";
import { TraceDebounceField } from "./TraceDebounceField";

/** One-line preview shown when the Cadence facet is collapsed. */
function cadenceSummary(draft: AutomationDraft): string {
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

const CADENCE_HELP = {
  trace:
    "How often notifications go out — one per matching trace, or batched into a digest — plus how long to wait for late spans before evaluating.",
  customGraph:
    "What makes the alert fire: the watched metric crosses this threshold over the chosen window.",
  report: "When it's sent, as a recurring schedule in the timezone you pick.",
} as const;

/**
 * The Cadence facet (ADR-043 facet 4) — "what makes it run, and how often?".
 * Owns all timing: an automation's digest cadence + settle window, an
 * alert's threshold rule, a report's schedule. Reads and writes the draft
 * through the store.
 */
export function CadenceSection({
  isEdit = false,
  accordion,
}: {
  isEdit?: boolean;
  accordion?: FacetAccordionProps;
}) {
  const draft = useDraft();

  return (
    <FacetSection
      title="Cadence"
      help={CADENCE_HELP[draft.source]}
      accordion={accordion}
      complete={cadenceIsSet(draft)}
      summary={cadenceSummary(draft)}
    >
      {draft.source === "customGraph" ? (
        <GraphCadence />
      ) : draft.source === "report" ? (
        <ReportCadence isEdit={isEdit} />
      ) : (
        <HStack align="start" gap={4}>
          <Box flex="1" minWidth="0">
            <CadenceField />
          </Box>
          <Box flex="1" minWidth="0">
            <TraceDebounceField />
          </Box>
        </HStack>
      )}
    </FacetSection>
  );
}

/** Alert cadence: the threshold rule that fires it. */
function GraphCadence() {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);
  const { operator, threshold, timePeriod } = draft.graphAlert;

  // The threshold is held as text while editing so intermediate states
  // ("-", "1e", empty) aren't coerced mid-keystroke; the store carries the
  // parsed number (or NaN, which blocks Save) so the gate stays honest.
  const [thresholdText, setThresholdText] = useState(() =>
    Number.isFinite(threshold) ? String(threshold) : "",
  );
  useEffect(() => {
    setThresholdText(Number.isFinite(threshold) ? String(threshold) : "");
    // Only resync when the committed value changes from outside this field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold]);

  const parsed = thresholdText.trim() === "" ? NaN : Number(thresholdText);
  const thresholdInvalid = !Number.isFinite(parsed);

  const onThresholdChange = (raw: string) => {
    setThresholdText(raw);
    const next = raw.trim() === "" ? NaN : Number(raw);
    dispatch({
      type: "SET_GRAPH_ALERT",
      value: { ...draft.graphAlert, threshold: next },
    });
  };

  return (
    <VStack align="stretch" gap={4}>
      <HStack gap={3}>
        <Field.Root flex="1">
          <Field.Label>Operator</Field.Label>
          <NativeSelect.Root>
            <NativeSelect.Field
              value={operator}
              onChange={(e) =>
                dispatch({
                  type: "SET_GRAPH_ALERT",
                  value: {
                    ...draft.graphAlert,
                    operator: e.target.value as GraphAlertOperator,
                  },
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
            onChange={(e) => onThresholdChange(e.target.value)}
          />
          <Field.ErrorText>Enter a number to compare against.</Field.ErrorText>
        </Field.Root>
      </HStack>

      <Field.Root>
        <Field.Label>Time window</Field.Label>
        <NativeSelect.Root>
          <NativeSelect.Field
            value={timePeriod}
            onChange={(e) =>
              dispatch({
                type: "SET_GRAPH_ALERT",
                value: {
                  ...draft.graphAlert,
                  timePeriod: Number(e.target.value) as GraphAlertTimePeriod,
                },
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
        {Number.isFinite(parsed) ? parsed : "…"} over{" "}
        {TIME_PERIOD_LABELS[timePeriod]}.
      </Text>
    </VStack>
  );
}

/** Report cadence: a friendly recurring-schedule picker (raw cron behind an
 *  opt-in Advanced switch), timezone defaulting to the viewer's locale. */
function ReportCadence({ isEdit }: { isEdit: boolean }) {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);
  const report = draft.report;

  return (
    <ReportScheduleField
      cron={report.cron}
      timezone={report.timezone}
      isEdit={isEdit}
      onChange={(next) =>
        dispatch({
          type: "SET_REPORT",
          value: { ...report, cron: next.cron, timezone: next.timezone },
        })
      }
    />
  );
}
