import { Button, Input, KeyValue, Panel, Select, Stack } from "@langwatch/design-system-internal";
import { SimRefusal } from "@langwatch/sim-console";
import { useState } from "react";

import { type Info, saveSettings } from "./llm-api.ts";

const ERROR_OPTIONS = [
  { value: "0", label: "Off: answer normally" },
  { value: "400", label: "400 bad request" },
  { value: "401", label: "401 unauthorised" },
  { value: "403", label: "403 forbidden" },
  { value: "404", label: "404 model not found" },
  { value: "429", label: "429 rate limited" },
  { value: "500", label: "500 server error" },
  { value: "502", label: "502 bad gateway" },
  { value: "503", label: "503 unavailable" },
  { value: "529", label: "529 overloaded (Anthropic)" },
];

/** What one call can ask for itself; each wins over the settings above. */
const OVERRIDES = [
  { label: "X-Llmsim-Seed", value: 'Pins the seed for this call; "random" draws a fresh one.' },
  { label: "X-Llmsim-Mode", value: '"langy" echoes the last message and runs its /tool lines.' },
  { label: "X-Llmsim-Error", value: "Answers this call with that 4xx or 5xx status." },
  { label: "Model error-<status>", value: 'A model name holding "error-429" answers 429.' },
  { label: "Model langy-echo", value: "Same as X-Llmsim-Mode langy." },
];

/** The switches every call without its own X-Llmsim-* header follows. */
export const SettingsPanel = ({ info, onSaved }: { info: Info; onSaved: () => void }) => {
  const { settings } = info;
  const [forcedError, setForcedError] = useState(String(settings.forcedError));
  const [seed, setSeed] = useState(settings.seed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await saveSettings({ settings: { forcedError: Number(forcedError), seed: seed.trim() } });
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="llm-settings" data-testid="settings">
      <Stack gap={4}>
        <Panel title="Answers">
          <Stack gap={4}>
            <Select
              label="Forced error"
              options={ERROR_OPTIONS}
              value={forcedError}
              onChange={setForcedError}
            />
            <Input
              label="Seed"
              hint='Empty seeds each call from its prompt; "random" draws a fresh seed per call; anything else pins one.'
              value={seed}
              onChange={setSeed}
            />
            {error ? <SimRefusal message={error} /> : null}
            <div>
              <Button variant="primary" loading={saving} onClick={() => void save()}>
                Save
              </Button>
            </div>
          </Stack>
        </Panel>
        <Panel title="Per-call overrides">
          <KeyValue
            items={OVERRIDES.map((override) => ({ ...override, mono: false, copy: false }))}
          />
        </Panel>
        <Panel title="Simulator">
          <KeyValue
            items={[
              { label: "Models", value: info.models.join(", ") || "any", copy: false },
              { label: "Calls kept", value: String(info.capacity), copy: false },
            ]}
          />
        </Panel>
      </Stack>
    </div>
  );
};
