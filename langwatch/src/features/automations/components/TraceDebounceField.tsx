import { Field, HStack, Input, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import {
  MAX_TRACE_DEBOUNCE_MS,
  MIN_TRACE_DEBOUNCE_MS,
} from "~/automations/cadences";
import { useAutomationStore } from "../state/automationStore";
import { useDraft } from "../state/selectors";

const MIN_SECONDS = Math.floor(MIN_TRACE_DEBOUNCE_MS / 1000);
const MAX_SECONDS = Math.floor(MAX_TRACE_DEBOUNCE_MS / 1000);

/**
 * Per-trigger trace-readiness debounce (ADR-026). Notify actions only —
 * the cadence secondary drawer gates this on `isNotifyAction`, so no
 * internal gate. Persist actions dispatch inline and ignore the column.
 * Exposed as seconds for readability; converted to/from milliseconds at
 * the boundary since the column and the queue both speak ms.
 *
 * Manual entry uses local draft state so the user can type values that
 * transit below MIN_SECONDS without snapping (e.g. typing `6` toward
 * `60` doesn't get clamped to `MIN_SECONDS` mid-keystroke), and an
 * empty field reads as "no edit yet" rather than collapsing to MIN.
 * Clamp + commit happen on blur and Enter.
 */
export function TraceDebounceField() {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);

  const committedSeconds = Math.round(draft.traceDebounceMs / 1000);
  const [localValue, setLocalValue] = useState<string>(
    String(committedSeconds),
  );

  useEffect(() => {
    setLocalValue(String(committedSeconds));
  }, [committedSeconds]);

  const commit = (raw: string) => {
    const parsed = Number(raw);
    if (raw === "" || !Number.isFinite(parsed)) {
      setLocalValue(String(committedSeconds));
      return;
    }
    const clampedSeconds = Math.min(
      MAX_SECONDS,
      Math.max(MIN_SECONDS, Math.round(parsed)),
    );
    setLocalValue(String(clampedSeconds));
    if (clampedSeconds !== committedSeconds) {
      dispatch({
        type: "SET_TRACE_DEBOUNCE_MS",
        value: clampedSeconds * 1000,
      });
    }
  };

  return (
    <Field.Root>
      <Field.Label>Settle window</Field.Label>
      <HStack>
        <Input
          type="number"
          min={MIN_SECONDS}
          max={MAX_SECONDS}
          step={1}
          value={localValue}
          width="6rem"
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit((e.target as HTMLInputElement).value);
            }
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
