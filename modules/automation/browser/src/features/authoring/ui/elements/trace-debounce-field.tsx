import { Field, HStack, Input, Text } from "@chakra-ui/react";
import { MAX_TRACE_DEBOUNCE_MS, MIN_TRACE_DEBOUNCE_MS } from "@langwatch/automation-contract";
import { useState } from "react";

const MIN_SECONDS = Math.floor(MIN_TRACE_DEBOUNCE_MS / 1000);
const MAX_SECONDS = Math.floor(MAX_TRACE_DEBOUNCE_MS / 1000);

/** Controlled settle-window editor. Milliseconds remain the transport value. */
export function AutomationTraceDebounceField({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const committedSeconds = Math.round(value / 1000);
  const [localValue, setLocalValue] = useState(String(committedSeconds));

  const [seededFrom, setSeededFrom] = useState(committedSeconds);
  if (seededFrom !== committedSeconds) {
    setSeededFrom(committedSeconds);
    setLocalValue(String(committedSeconds));
  }

  const commit = (raw: string) => {
    const parsed = Number(raw);
    if (raw === "" || !Number.isFinite(parsed)) {
      setLocalValue(String(committedSeconds));
      return;
    }
    const clampedSeconds = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(parsed)));
    setLocalValue(String(clampedSeconds));
    if (clampedSeconds !== committedSeconds) onChange(clampedSeconds * 1000);
  };

  return (
    <Field.Root>
      <Field.Label>Settle window</Field.Label>
      <HStack>
        <Input
          type="number"
          data-testid="automation-settle-window-input"
          min={MIN_SECONDS}
          max={MAX_SECONDS}
          step={1}
          value={localValue}
          width="6rem"
          onChange={(event) => setLocalValue(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit((event.target as HTMLInputElement).value);
          }}
        />
        <Text textStyle="sm" color="fg.muted">
          seconds
        </Text>
      </HStack>
      <Text textStyle="xs" color="fg.muted" mt={1}>
        A trace counts as settled once no new spans have arrived for this long. Messages wait for
        it, so even per-trace delivery arrives about this many seconds after the trace finishes.
        Raise it to absorb late spans, lower it to cut the wait.
      </Text>
    </Field.Root>
  );
}
