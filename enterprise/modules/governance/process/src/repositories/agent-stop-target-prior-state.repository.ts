// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Whether each target of a stop was already stopped before the stop first touched it
 * (specs/agent-kill-switch.feature). Written once, before the platform call, so a retry after a
 * successful call still knows the change belongs to the stop and a restore reverts it.
 */
export abstract class AgentStopTargetPriorStateRepository {
  /** Stores `wasStopped` unless the target already has a value; answers the stored value. */
  abstract recordOnce(input: {
    organizationId: string;
    stopId: string;
    targetId: string;
    wasStopped: boolean;
    recordedAt: number;
  }): Promise<boolean>;
  /** The stored value, or empty when the stop never touched the target. */
  abstract findPriorStates(input: {
    organizationId: string;
    stopId: string;
    targetId: string;
  }): Promise<boolean[]>;
}
