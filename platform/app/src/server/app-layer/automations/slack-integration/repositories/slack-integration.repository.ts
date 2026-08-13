import type { SlackIntegration } from "@prisma/client";

/** An automation that still carries its own encrypted Slack bot token. */
export interface LegacySlackTokenAutomation {
  id: string;
  name: string;
}

/**
 * Storage for the project's Slack workspace connection (ADR-093 §5), plus the
 * two reads the legacy-token migration needs over the automations that predate
 * it. Every method is bounded by the owning project — the row's scope pair is
 * `(PROJECT, projectId)`, and the tenancy regime rejects a query that names
 * neither the scope nor the organization.
 */
export interface SlackIntegrationRepository {
  findByProject(params: {
    projectId: string;
  }): Promise<SlackIntegration | null>;

  /**
   * Store or replace the connection for one project. Rotation is the same
   * write: a fresh ciphertext and a freshly pinned workspace over the same
   * scope pair.
   */
  upsertForProject(params: {
    projectId: string;
    organizationId: string;
    botTokenEncrypted: string;
    slackTeamId: string;
    slackTeamName: string;
    userId: string;
  }): Promise<SlackIntegration>;

  deleteForProject(params: { projectId: string }): Promise<void>;

  /** Live automations in the project whose stored Slack params carry a token. */
  findAllWithOwnSlackToken(params: {
    projectId: string;
  }): Promise<LegacySlackTokenAutomation[]>;

  /**
   * Drop the stored token from one automation's Slack params, leaving every
   * other field alone. Returns false when the row is gone or no longer carries
   * one, so a bulk switch can report it without failing the batch.
   */
  clearOwnSlackToken(params: {
    projectId: string;
    triggerId: string;
  }): Promise<boolean>;
}
