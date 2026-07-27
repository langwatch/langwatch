/**
 * What the app can do to a queue, and when.
 *
 * The catalog is pure data: no React, no React Native, no tRPC. The rules about
 * which action is offered, which one destroys work, and which one has to be
 * typed out are decisions worth testing on their own — and worth reading in one
 * place rather than inferred from five screens.
 *
 * Three shapes of guardrail appear below, chosen per action by what is actually
 * at risk:
 *
 *   - a plain confirmation, when the action is reversible (unblock, unpause,
 *     replay — the work still exists afterwards);
 *   - a PREVIEW, when the operator cannot see the blast radius from the row they
 *     tapped (anything that says "all");
 *   - a typed CONFIRMATION WORD, when the work is destroyed rather than moved.
 *
 * A canary is not a guardrail on a single action; it is a separate, smaller
 * action offered alongside the sweeping one, so a fix can be proven on a handful
 * before it is applied to everything.
 */

export interface ActionSpec {
  id: ActionId;
  /** Imperative, and specific enough to read alone in a sheet. */
  title: string;
  /** What it does and what it costs. Shown on the confirmation step. */
  description: string;
  /** Destroys work, or is otherwise not undoable. Rendered in the danger tint. */
  destructive: boolean;
  /**
   * Typed before the action is enabled. Present only where the work cannot be
   * recovered — asking for it everywhere would train operators to type it
   * without reading.
   */
  confirmWord?: string;
  /** Show the blast radius before offering to run. */
  needsPreview?: boolean;
}

export type ActionId =
  | "unblock-group"
  | "drain-group"
  | "move-group-to-dlq"
  | "retry-job"
  | "unblock-all"
  | "canary-unblock"
  | "canary-redrive"
  | "move-all-blocked-to-dlq"
  | "replay-dlq-group"
  | "replay-all-dlq"
  | "unpause-pipeline"
  | "unpause-tenant"
  | "drain-tenant"
  | "dismiss-anomaly"
  | "delete-blob";

/** How many groups a canary touches. Small enough to read the result by eye. */
export const CANARY_COUNT = 5;

const DISCARD = "DISCARD";
const DELETE = "DELETE";

const SPECS: Record<ActionId, ActionSpec> = {
  "unblock-group": {
    id: "unblock-group",
    title: "Unblock",
    description:
      "Clears the block so this group starts processing again. Its jobs are untouched — if whatever failed is still failing, it will block again.",
    destructive: false,
  },
  "drain-group": {
    id: "drain-group",
    title: "Drain",
    description:
      "Discards every job queued in this group. The work is gone and cannot be recovered.",
    destructive: true,
    confirmWord: DISCARD,
  },
  "move-group-to-dlq": {
    id: "move-group-to-dlq",
    title: "Move to dead letters",
    description:
      "Moves this group's jobs to the dead letter queue, clearing the block. Nothing is lost — they can be replayed from there.",
    destructive: false,
  },
  "retry-job": {
    id: "retry-job",
    title: "Retry this job",
    description:
      "Retries this one job. The rest of the group is left where it is.",
    destructive: false,
  },
  "unblock-all": {
    id: "unblock-all",
    title: "Unblock every group",
    description:
      "Clears the block on every blocked group in this queue. Try a handful first if you are not sure the cause is fixed.",
    destructive: false,
  },
  "canary-unblock": {
    id: "canary-unblock",
    title: `Unblock ${CANARY_COUNT} first`,
    description: `Unblocks ${CANARY_COUNT} blocked groups and names them, so you can watch whether they get through before unblocking the rest.`,
    destructive: false,
  },
  "canary-redrive": {
    id: "canary-redrive",
    title: `Redrive ${CANARY_COUNT} first`,
    description: `Redrives ${CANARY_COUNT} groups and names them, so you can watch whether they get through before redriving the rest.`,
    destructive: false,
  },
  "move-all-blocked-to-dlq": {
    id: "move-all-blocked-to-dlq",
    title: "Move every blocked group to dead letters",
    description:
      "Moves the jobs of every blocked group to the dead letter queue, clearing the blocks. Nothing is lost — they can be replayed from there.",
    destructive: false,
    needsPreview: true,
  },
  "replay-dlq-group": {
    id: "replay-dlq-group",
    title: "Replay",
    description:
      "Puts this group's dead-lettered jobs back on the queue to be processed again.",
    destructive: false,
  },
  "replay-all-dlq": {
    id: "replay-all-dlq",
    title: "Replay every dead letter",
    description:
      "Puts every dead-lettered job in this queue back on the queue. If the cause is not fixed they will come straight back.",
    destructive: false,
  },
  "unpause-pipeline": {
    id: "unpause-pipeline",
    title: "Unpause",
    description: "Lets this pipeline start processing again.",
    destructive: false,
  },
  "unpause-tenant": {
    id: "unpause-tenant",
    title: "Unpause",
    description: "Lets this project's work start processing again.",
    destructive: false,
  },
  "drain-tenant": {
    id: "drain-tenant",
    title: "Drain this project",
    description:
      "Discards every job queued for this project in this queue. The work is gone and cannot be recovered.",
    destructive: true,
    confirmWord: DISCARD,
  },
  "dismiss-anomaly": {
    id: "dismiss-anomaly",
    title: "Dismiss",
    description:
      "Stops flagging this project. If the rate stays where it is, the next check will flag it again.",
    destructive: false,
  },
  "delete-blob": {
    id: "delete-blob",
    title: "Delete payload",
    description:
      "Deletes the stored bytes. Any job still expecting them will finish without doing its work, and nothing will report an error — so only delete a payload nothing holds.",
    destructive: true,
    confirmWord: DELETE,
  },
};

export function actionSpec(id: ActionId): ActionSpec {
  return SPECS[id];
}

/**
 * Actions for one group.
 *
 * An action is offered only when it would do something: unblocking a group that
 * is not blocked, or draining one with nothing queued, is a control that can
 * only mislead.
 */
export function groupActions(group: {
  isBlocked: boolean;
  pendingJobs: number;
}): ActionSpec[] {
  const actions: ActionSpec[] = [];
  if (group.isBlocked) {
    actions.push(SPECS["unblock-group"], SPECS["move-group-to-dlq"]);
  }
  if (group.pendingJobs > 0) actions.push(SPECS["drain-group"]);
  return actions;
}

/**
 * Actions for a whole queue, ordered gentlest first.
 *
 * There is no "drain every blocked group": the server offers no such mutation,
 * and draining stays a group-at-a-time decision on the web for the same reason.
 * Clearing a whole queue is done by moving it to dead letters, where the work
 * still exists.
 */
export function queueActions(queue: {
  blockedGroupCount: number;
  dlqCount: number;
}): ActionSpec[] {
  const actions: ActionSpec[] = [];
  if (queue.blockedGroupCount > 0) {
    actions.push(
      SPECS["canary-unblock"],
      SPECS["canary-redrive"],
      SPECS["unblock-all"],
      SPECS["move-all-blocked-to-dlq"],
    );
  }
  if (queue.dlqCount > 0) actions.push(SPECS["replay-all-dlq"]);
  return actions;
}

export function pausedKeyActions(): ActionSpec[] {
  return [SPECS["unpause-pipeline"]];
}

export function pausedTenantActions(): ActionSpec[] {
  return [SPECS["unpause-tenant"], SPECS["drain-tenant"]];
}

export function deadLetterActions(): ActionSpec[] {
  return [SPECS["replay-dlq-group"]];
}

export function anomalyActions(): ActionSpec[] {
  return [SPECS["dismiss-anomaly"]];
}

/**
 * A payload with a live lease is not offered for deletion.
 *
 * The server refuses it anyway — the lease guard is inside the delete script —
 * so offering it would only produce a confirmation that ends in a refusal.
 */
export function blobActions(blob: { liveLeases: number }): ActionSpec[] {
  return blob.liveLeases === 0 ? [SPECS["delete-blob"]] : [];
}

export function jobActions(group: { isBlocked: boolean }): ActionSpec[] {
  return group.isBlocked ? [SPECS["retry-job"]] : [];
}

/**
 * Exact match: no trimming, no case folding. Half the value of a typed
 * confirmation is that it cannot be produced by a thumb brushing the screen,
 * and a forgiving comparison gives that away.
 */
export function isActionConfirmed(spec: ActionSpec, typed: string): boolean {
  if (!spec.confirmWord) return true;
  return typed === spec.confirmWord;
}
