import { useState } from "react";

import { ActionSheet, ActionsTrigger, type BoundAction } from "./ActionSheet";

/**
 * A row's actions trigger plus the sheet it opens, as one component.
 *
 * Every list row that can be acted on renders exactly one of these in its
 * trailing position — the mobile counterpart of the web's row overflow menu.
 * Keeping the trigger and the sheet together means a screen never has to hold
 * "which row is the sheet open for" state of its own.
 */
export function RowActions({
  label,
  title,
  actions,
}: {
  /** Names the row for the screen reader and titles the sheet's subject line. */
  label: string;
  title: string;
  actions: BoundAction[];
}) {
  const [open, setOpen] = useState(false);

  // A row with nothing to offer shows no trigger at all, rather than one that
  // opens onto "nothing to do here".
  if (actions.length === 0) return null;

  return (
    <>
      <ActionsTrigger label={label} onPress={() => setOpen(true)} />
      <ActionSheet
        title={title}
        subject={label}
        actions={actions}
        visible={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
