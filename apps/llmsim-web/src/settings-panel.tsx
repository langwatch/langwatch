import { Button, Input, Select } from "@langwatch/design-system-internal";
import { SimRefusal } from "@langwatch/sim-console";
import { useState } from "react";

import { type Settings, saveSettings } from "./llm-api.ts";

const ERROR_OPTIONS = [
  { value: "0", label: "Off: answer normally" },
  { value: "429", label: "429 rate limited" },
  { value: "500", label: "500 server error" },
  { value: "503", label: "503 overloaded" },
];

/** The switches every call without its own X-Llmsim-* header follows. */
export const SettingsPanel = ({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: () => void;
}) => {
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
      <Button variant="primary" loading={saving} onClick={() => void save()}>
        Save
      </Button>
    </div>
  );
};
