import type { RunActor } from "@langwatch/scenario-contract";

/** The agent fields the ownership check reads. */
export type AgentTestOwnershipSubject = {
  id: string;
  name: string;
  type: string;
  ownerUserId: string | null;
};

/**
 * Refuses a test turn or run against a personal development agent of someone
 * other than the actor.
 *
 * A port rather than a direct `@langwatch/suite-server` import: a feature
 * server package may not import another feature's server package (strict
 * feature layout). This root is composed in `apps/api`, from
 * `assertConnectedAgentsRunnable`.
 */
export abstract class AgentTestOwnershipPort {
  abstract assertRunnable(input: {
    agents: readonly AgentTestOwnershipSubject[];
    actor: RunActor | undefined;
  }): Promise<void>;
}
