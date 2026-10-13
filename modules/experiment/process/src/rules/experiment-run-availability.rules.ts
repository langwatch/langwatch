/**
 * What a process refuses of a run, by the capability it lacks: a run lives in the shared Redis
 * every replica folds into, and a polled run answers with a link to this deployment's address.
 */

/** A refusal's capability, and the process named in a start's refusal. */
export type ExperimentRunRefusal = Readonly<{ capability: string; process?: string }>;

/** What this process refuses: starting a run, reading one, or neither. */
export type ExperimentRunRefusals = Readonly<{
  start?: ExperimentRunRefusal;
  read?: ExperimentRunRefusal;
}>;

/** The refusals the retired run loop answered with, for a process with or without each. */
export function runRefusalsOf({
  sharedStore,
  publicBaseUrl,
  processName,
}: {
  sharedStore: boolean;
  publicBaseUrl: string | undefined;
  processName: string;
}): ExperimentRunRefusals {
  if (!sharedStore) {
    return {
      start: {
        capability: "progress store, so a run it started could never be polled for",
        process: processName,
      },
      read: { capability: "experiment run progress store" },
    };
  }
  if (!publicBaseUrl) {
    return {
      start: {
        capability: "public address, so a run could not answer with the link to its own results",
        process: processName,
      },
    };
  }

  return {};
}
