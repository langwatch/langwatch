import { showErrorToast } from "@langwatch/browser-host/errors";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Button } from "@langwatch/design-system/primitives";
import { CloudOff } from "lucide-react";
import { useState } from "react";

const WHO_UPDATED_IT: Record<string, string> = {
  langy: "Langy updated this evaluation",
  api: "This evaluation was updated through the API",
};

export function WorkbenchStaleStatus({
  actorLabel,
  isDirty,
  onReload,
}: {
  actorLabel?: string;
  isDirty: boolean;
  onReload: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const who = WHO_UPDATED_IT[actorLabel ?? ""] ?? "This evaluation was updated somewhere else";
  const consequence = isDirty
    ? "Reloading shows the latest version and discards your unsaved edits."
    : "Reloading shows the latest version.";

  const reload = async () => {
    setIsReloading(true);
    try {
      await onReload();
      setOpen(false);
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't reload this evaluation" });
    } finally {
      setIsReloading(false);
    }
  };

  return (
    <>
      <Button size="xs" variant="ghost" color="orange.fg" onClick={() => setOpen(true)}>
        <CloudOff size={14} />
        Out of date
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!isReloading) setOpen(nextOpen);
        }}
        title="Reload this evaluation?"
        message={`${who}. ${consequence}`}
        confirmLabel="Reload"
        tone="warning"
        loading={isReloading}
        onConfirm={() => void reload()}
      />
    </>
  );
}
