import { Field, HStack, Input, Text } from "@chakra-ui/react";
import { MAX_TRACE_DEBOUNCE_MS, MIN_TRACE_DEBOUNCE_MS } from "@langwatch/automation-contract";
import { useEffect, useState } from "react";

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

  useEffect(() => {
    setLocalValue(String(committedSeconds));
  }, [committedSeconds]);

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
        How long to wait for late spans before evaluating a trace. Higher absorbs late spans, lower
        cuts latency.
      </Text>
    </Field.Root>
  );
}
