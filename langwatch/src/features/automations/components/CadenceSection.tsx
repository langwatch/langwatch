import {
  Field,
  HStack,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import {
  GRAPH_ALERT_TIME_PERIODS,
  type GraphAlertOperator,
  type GraphAlertTimePeriod,
} from "~/server/app-layer/triggers/graph-alert.builder";
import {
  OPERATOR_LABELS,
  TIME_PERIOD_LABELS,
} from "../logic/draftReducer";
import { useAutomationStore } from "../state/automationStore";
import { useDraft } from "../state/selectors";
import { CadenceField } from "./CadenceField";
import { FacetSection } from "./FacetSection";
import { TraceDebounceField } from "./TraceDebounceField";

const CADENCE_HELP = {
  trace:
    "How often notifications go out — one per matching trace, or batched into a digest — plus how long to wait for late spans before evaluating.",
  customGraph:
    "What makes the alert fire: the watched metric crosses this threshold over the chosen window.",
  report: "When the report is sent, as a cron schedule in the timezone you pick.",
} as const;

/**
 * The Cadence facet (ADR-043 facet 4) — "what makes it run, and how often?".
 * Owns all timing: an automation's digest cadence + settle window, an
 * alert's threshold rule, a report's schedule. Reads and writes the draft
 * through the store.
 */
export function CadenceSection() {
  const draft = useDraft();

  return (
    <FacetSection title="Cadence" help={CADENCE_HELP[draft.source]}>
      {draft.source === "customGraph" ? (
        <GraphCadence />
      ) : draft.source === "report" ? (
        <ReportCadence />
      ) : (
        <VStack align="stretch" gap={5}>
          <CadenceField />
          <TraceDebounceField />
        </VStack>
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

/** Report cadence: the cron schedule + timezone. */
function ReportCadence() {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);
  const report = draft.report;
  const scheduleInvalid = report.cron.trim() === "";

  return (
    <VStack align="stretch" gap={4}>
      <Field.Root invalid={scheduleInvalid}>
        <Field.Label>Schedule (cron)</Field.Label>
        <Input
          value={report.cron}
          placeholder="0 9 * * 1"
          onChange={(e) =>
            dispatch({
              type: "SET_REPORT",
              value: { ...report, cron: e.target.value },
            })
          }
        />
        {scheduleInvalid ? (
          <Field.ErrorText>
            Enter a cron schedule (e.g. 0 9 * * 1 for Mondays at 9am).
          </Field.ErrorText>
        ) : null}
      </Field.Root>
      <Field.Root>
        <Field.Label>Timezone</Field.Label>
        <Input
          value={report.timezone}
          placeholder="UTC"
          onChange={(e) =>
            dispatch({
              type: "SET_REPORT",
              value: { ...report, timezone: e.target.value },
            })
          }
        />
      </Field.Root>
    </VStack>
  );
}
