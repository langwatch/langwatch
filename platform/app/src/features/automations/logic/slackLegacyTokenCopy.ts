/**
 * The words for switching an automation off its own Slack token and onto the
 * project integration (ADR-093 §5).
 *
 * Switching deletes the only copy of that token. It was encrypted the moment it
 * was pasted and has never been shown since, the composer no longer has a field
 * to retype it into, and the automation may be pointed at a different workspace
 * than the one the project connected — the exact hazard most-specific-first
 * resolution exists to avoid. So the action is confirmed rather than taken on
 * one click, and the confirmation says what is actually about to happen.
 *
 * One home for the sentences because three surfaces ask the same question: the
 * list row, the composer, and the settings card's bulk switch.
 */

interface Confirmation {
  title: string;
  message: string;
  confirmLabel: string;
}

/** The consequence both variants have to state, in the same words. */
function consequence(workspaceName: string | null): string {
  const workspace = workspaceName
    ? `the ${workspaceName} Slack workspace`
    : "the Slack workspace";
  return (
    `The Slack token saved on it is deleted and cannot be recovered — it was ` +
    `never shown again after it was saved. Later messages go to ${workspace} ` +
    `connected for this project, which may not be the workspace it posts to ` +
    `today.`
  );
}

export function confirmSwitchToProjectIntegration({
  automationName,
  workspaceName,
}: {
  /** Omitted where the surface has no name to hand — the composer edits a
   *  draft whose name lives on another step. */
  automationName?: string;
  workspaceName: string | null;
}): Confirmation {
  return {
    title: automationName
      ? `Use the project integration for "${automationName}"?`
      : "Use the project integration for this automation?",
    message: consequence(workspaceName),
    confirmLabel: "Switch this automation",
  };
}

export function confirmSwitchAllToProjectIntegration({
  count,
  workspaceName,
}: {
  count: number;
  workspaceName: string | null;
}): Confirmation {
  const subject =
    count === 1
      ? "1 automation"
      : `all ${count} automations that still use their own token`;
  return {
    title: `Switch ${subject} to the project integration?`,
    message: `${consequence(workspaceName)} Each automation is switched on its own, so one that cannot be updated leaves the others switched.`,
    confirmLabel: count === 1 ? "Switch this automation" : "Switch them all",
  };
}
