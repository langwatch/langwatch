/** A switch that saves itself: "Saved" or the refusal sits under it, no Save button. */

import { Text, VStack } from "@langwatch/design-system/primitives";
import { Switch } from "@langwatch/design-system/switch";
import { useState } from "react";

export type SaveOutcome = {
  onSuccess: () => void;
  onError: (message: string) => void;
};

export function SaveOnChangeSwitch({
  checked,
  disabled,
  label,
  onSave,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onSave: (args: { checked: boolean } & SaveOutcome) => void;
}) {
  const [value, setValue] = useState(checked);
  const [status, setStatus] = useState<{ kind: "idle" | "saved" | "error"; message?: string }>({
    kind: "idle",
  });

  const change = (next: boolean) => {
    const previous = value;
    setValue(next);
    setStatus({ kind: "idle" });
    onSave({
      checked: next,
      onSuccess: () => setStatus({ kind: "saved" }),
      onError: (message) => {
        setValue(previous);
        setStatus({ kind: "error", message });
      },
    });
  };

  const note = status.kind === "saved" ? "Saved" : (status.message ?? "");

  return (
    <VStack align="end" gap={1}>
      <Switch
        colorPalette="accent"
        checked={value}
        disabled={disabled}
        onCheckedChange={({ checked: next }) => change(next)}
        inputProps={{ "aria-label": label }}
      />
      <output>
        <Text textStyle="caption" color={status.kind === "error" ? "fg.error" : "fg.muted"}>
          {note}
        </Text>
      </output>
    </VStack>
  );
}
