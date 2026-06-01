import { Field, HStack, Input, Text } from "@chakra-ui/react";
import {
  MAX_TRACE_DEBOUNCE_MS,
  MIN_TRACE_DEBOUNCE_MS,
} from "~/automations/cadences";
import { useAutomationStore } from "../state/automationStore";
import { useDraft } from "../state/selectors";

const MIN_SECONDS = Math.floor(MIN_TRACE_DEBOUNCE_MS / 1000);
const MAX_SECONDS = Math.floor(MAX_TRACE_DEBOUNCE_MS / 1000);

/**
 * Per-trigger trace-readiness debounce (ADR-030). Notify actions only —
 * the cadence secondary drawer gates this on `isNotifyAction`, so no
 * internal gate. Persist actions dispatch inline and ignore the column.
 * Exposed as seconds for readability; converted to/from milliseconds at
 * the boundary since the column and the queue both speak ms.
 */
export function TraceDebounceField() {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);

  const seconds = Math.round(draft.traceDebounceMs / 1000);

  return (
    <Field.Root>
      <Field.Label>Settle window</Field.Label>
      <HStack>
        <Input
          type="number"
          min={MIN_SECONDS}
          max={MAX_SECONDS}
          step={1}
          value={seconds}
          width="6rem"
          onChange={(e) => {
            const next = Number(e.target.value);
            if (!Number.isFinite(next)) return;
            const clampedSeconds = Math.min(
              MAX_SECONDS,
              Math.max(MIN_SECONDS, Math.round(next)),
            );
            dispatch({
              type: "SET_TRACE_DEBOUNCE_MS",
              value: clampedSeconds * 1000,
            });
          }}
        />
        <Text textStyle="sm" color="fg.muted">
          seconds
        </Text>
      </HStack>
      <Text textStyle="xs" color="fg.muted" mt={1}>
        Wait this long after the last span before re-evaluating filters.
        Higher values absorb late spans on slow traces; lower values cut
        notification latency.
      </Text>
    </Field.Root>
  );
}
