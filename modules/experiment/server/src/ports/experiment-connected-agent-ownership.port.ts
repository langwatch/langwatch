import type { RunActor } from "@langwatch/scenario-contract";

/** The agent fields the ownership check reads. */
export type ExperimentConnectedAgentSubject = {
  id: string;
  name: string;
  type: string;
  ownerUserId?: string | null;
};

/**
 * Refuses a run against a personal development agent of someone other than the
 * actor, before any cell exists.
 */
export abstract class ExperimentConnectedAgentOwnershipPort {
  abstract assertRunnable(input: {
    agents: readonly ExperimentConnectedAgentSubject[];
    actor: RunActor | undefined;
  }): Promise<void>;
}
