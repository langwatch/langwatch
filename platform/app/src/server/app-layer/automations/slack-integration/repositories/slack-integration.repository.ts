import type {
  SlackIntegration,
  SlackIntegrationKind,
  SlackIntegrationScopeType,
} from "~/generated/prisma/client";

/** Where a project sits: what an ORGANIZATION connection is checked against. */
export interface SlackProjectScope {
  projectId: string;
  projectName: string;
  organizationId: string;
  organizationName: string;
}

/** Everything a stored connection holds, secret already in its at-rest form. */
export interface SlackConnectionRecord {
  name: string;
  kind: SlackIntegrationKind;
  scopeType: SlackIntegrationScopeType;
  scopeId: string;
  organizationId: string;
  botTokenEncrypted: string | null;
  webhookUrlEncrypted: string | null;
  secretFingerprint: string;
  secretHint: string;
  slackTeamId: string | null;
  slackTeamName: string | null;
}

/** The fields an edit may change. Kind and organization never change. */
export type SlackConnectionChanges = Partial<
  Omit<SlackConnectionRecord, "kind" | "organizationId">
>;

/**
 * Storage for named Slack connections (ADR-093 §5a). Every read is bounded by
 * a row id, the organization anchor or a scope pair, which is what the tenancy
 * regime requires of this table.
 */
export interface SlackIntegrationRepository {
  findProjectScope(params: {
    projectId: string;
  }): Promise<SlackProjectScope | null>;

  findById(params: { id: string }): Promise<SlackIntegration | null>;

  /** The project's PROJECT connections plus its organization's ORGANIZATION ones. */
  findAllUsableByProject(params: {
    organizationId: string;
    projectId: string;
  }): Promise<SlackIntegration[]>;

  /** The connections holding this secret in any of `scopes`, at most one per scope. */
  findAllByFingerprint(params: {
    organizationId: string;
    secretFingerprint: string;
    scopes: Pick<SlackConnectionRecord, "scopeType" | "scopeId">[];
  }): Promise<SlackIntegration[]>;

  /** Null when the scope already holds this fingerprint (the unique index). */
  create(params: {
    record: SlackConnectionRecord;
    actorId: string;
  }): Promise<SlackIntegration | null>;

  /** Null when the new fingerprint or scope collides with another connection. */
  update(params: {
    id: string;
    organizationId: string;
    changes: SlackConnectionChanges;
    actorId: string;
  }): Promise<SlackIntegration | null>;

  delete(params: { id: string; organizationId: string }): Promise<void>;

  /**
   * Active, non-deleted Slack automations in the organization's projects (all
   * but `exceptProjectId` when given) pointing at each of `ids`, keyed by
   * connection id (absent = none).
   */
  countDependentAutomations(params: {
    organizationId: string;
    ids: string[];
    exceptProjectId?: string;
  }): Promise<Map<string, number>>;
}
