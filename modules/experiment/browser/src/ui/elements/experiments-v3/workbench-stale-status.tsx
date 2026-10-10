import { showErrorToast } from "@langwatch/browser-host/errors";
import { Dialog } from "@langwatch/design-system/dialog";
import { Button, Text } from "@langwatch/design-system/primitives";
import { useState } from "react";

/** Who last wrote the newer version, named by the actor the server reported. */
const WHO_UPDATED_IT: Record<string, string> = {
  langy: "Langy updated this evaluation",
  api: "This evaluation was updated through the API",
};

/**
 * The header's one signal that the server holds a newer version of this workbench. Reloading
 * asks first, since it discards unsaved edits; a failed reload keeps the question open.
 * @see modules/experiment/specs/workbench-stale-status.feature
 */
export function WorkbenchStaleStatus({
  actorLabel,
  isDirty,
  onReload,
}: {
  actorLabel?: string;
  isDirty: boolean;
  onReload: () => Promise<void>;
}) {
  const [isAsking, setIsAsking] = useState(false);
  const [isReloading, setIsReloading] = useState(false);

  const who = WHO_UPDATED_IT[actorLabel ?? ""] ?? "This evaluation was updated somewhere else";
  const reload = () => {
    setIsReloading(true);
    void onReload()
      .then(() => setIsAsking(false))
      .catch((error) => showErrorToast({ error, fallbackTitle: "Couldn't reload this evaluation" }))
      .finally(() => setIsReloading(false));
  };

  return (
    <>
      <Button size="xs" variant="outline" colorPalette="orange" onClick={() => setIsAsking(true)}>
        Out of date
      </Button>
      {isAsking && (
        <Dialog.Root open size="sm" onOpenChange={({ open }) => !open && setIsAsking(false)}>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Reload this evaluation?</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Text>
                {who}. Reloading shows the latest version
                {isDirty ? " and discards your unsaved edits" : ""}.
              </Text>
            </Dialog.Body>
            <Dialog.Footer>
              <Button variant="ghost" onClick={() => setIsAsking(false)}>
                Cancel
              </Button>
              <Button colorPalette="accent" loading={isReloading} onClick={reload}>
                Reload
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </>
  );
}
