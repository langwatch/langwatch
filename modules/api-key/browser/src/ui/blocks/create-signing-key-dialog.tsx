import { Dialog } from "@langwatch/design-system/dialog";
import { Input } from "@langwatch/design-system/primitives";
import { SettingsField } from "@langwatch/design-system/settings-field";
import { useState } from "react";

/** Names a new signing key; the panel creates it and shows the secret once. */
export function CreateSigningKeyDialog({
  open,
  creating,
  onClose,
  onCreate,
}: {
  open: boolean;
  creating: boolean;
  onClose: () => void;
  onCreate: (input: { name: string }) => void;
}) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const close = () => {
    setName("");
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Create signing key"
      size="md"
      busy={creating}
      primaryAction={{
        label: "Create key",
        loading: creating,
        onClick: () => trimmed && onCreate({ name: trimmed }),
        "data-testid": "signing-key-create-confirm",
      }}
    >
      <SettingsField
        label="Name"
        hint="Name it after where it runs, so you know which deploy to update when you rotate it."
      >
        <Input
          value={name}
          maxLength={100}
          placeholder="Production"
          onChange={(event) => setName(event.target.value)}
        />
      </SettingsField>
    </Dialog>
  );
}
