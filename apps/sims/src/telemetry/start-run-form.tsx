import { Button, Inline, Input, Panel, Select, Stack } from "@langwatch/design-system-internal";
import { SimRefusal } from "@langwatch/sim-console";
import { useState, type FormEvent } from "react";

import { modes, type RunMode, type RunRequest } from "./telemetry-api.ts";

const modeOptions = modes.map((mode) => ({ value: mode, label: mode }));

const isMode = (value: string): value is RunMode => modes.some((mode) => mode === value);

/** Only the fields a mode reads go on the wire; the sim fills the rest. */
const requestOf = ({
  mode,
  preset,
  seed,
  count,
  rate,
  duration,
}: Record<"preset" | "seed" | "count" | "rate" | "duration", string> & { mode: RunMode }) => {
  const base = { mode, preset, seed: Number(seed) };
  if (mode === "load") return { ...base, rate: Number(rate), duration };
  return mode === "send" ? { ...base, batches: Number(count) } : { ...base, budget: Number(count) };
};

/** Starts a send, load or fuzz run at the stack's OTLP door. */
export const StartRunForm = ({
  presets,
  running,
  onStart,
}: {
  presets: string[];
  running: boolean;
  onStart: (args: { request: RunRequest }) => Promise<unknown>;
}) => {
  const [mode, setMode] = useState<RunMode>("send");
  const [preset, setPreset] = useState("");
  const [seed, setSeed] = useState("1");
  const [count, setCount] = useState("10");
  const [rate, setRate] = useState("5");
  const [duration, setDuration] = useState("30s");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState("");
  const chosen = preset || presets[0] || "";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setRefusal("");
    try {
      await onStart({
        request: requestOf({ mode, preset: chosen, seed, count, rate, duration }),
      });
    } catch (caught) {
      setRefusal(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Start a run">
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap={3}>
          <Inline gap={3} wrap>
            <Select
              label="Verb"
              options={modeOptions}
              value={mode}
              onChange={(value) => isMode(value) && setMode(value)}
            />
            <Select
              label="Preset"
              options={presets.map((name) => ({ value: name, label: name }))}
              value={chosen}
              onChange={setPreset}
            />
            <Input label="Seed" type="number" min={0} value={seed} onChange={setSeed} />
            {mode === "load" ? (
              <>
                <Input
                  label="Rate"
                  type="number"
                  min={0}
                  step="any"
                  value={rate}
                  onChange={setRate}
                />
                <Input label="Duration" value={duration} onChange={setDuration} />
              </>
            ) : (
              <Input
                label={mode === "send" ? "Batches" : "Budget"}
                type="number"
                min={1}
                value={count}
                onChange={setCount}
              />
            )}
          </Inline>
          <Inline gap={3}>
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={running || chosen === ""}
            >
              Start {mode}
            </Button>
          </Inline>
          {refusal !== "" && <SimRefusal message={refusal} />}
        </Stack>
      </form>
    </Panel>
  );
};
