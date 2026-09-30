import type { SlackConnectionKind, SlackConnectionScopeType } from "@langwatch/slack-contract";
import type { Instant } from "@langwatch/time";

/** Everything a stored connection holds, secret already in its at-rest form. */
export interface SlackConnectionRecord {
  name: string;
  kind: SlackConnectionKind;
  scopeType: SlackConnectionScopeType;
  scopeId: string;
  organizationId: string;
  botTokenEncrypted: string | null;
  webhookUrlEncrypted: string | null;
  secretFingerprint: string;
  secretHint: string;
  slackTeamId: string | null;
  slackTeamName: string | null;
}

/** A stored connection as the service reads it back. */
export type SlackConnectionRow = SlackConnectionRecord & {
  id: string;
  createdAt: Instant;
  updatedAt: Instant;
};

/** The fields an edit may change. Kind and organization never change. */
export type SlackConnectionChanges = Partial<
  Omit<SlackConnectionRecord, "kind" | "organizationId">
>;

export type SlackScope = Pick<SlackConnectionRecord, "scopeType" | "scopeId">;

/**
 * Storage for named Slack connections (ADR-093 §5a). Every read is bounded by
 * a row id, the organization anchor or a scope pair, which is what the tenancy
 * regime requires of this table. A create mints the connection's KSUID.
 */
export abstract class SlackConnectionRepository {
  /** Zero or one row. */
  abstract findById(input: { id: string }): Promise<SlackConnectionRow[]>;

  /** The project's PROJECT connections plus its organization's ORGANIZATION ones. */
  abstract findAllUsableByProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<SlackConnectionRow[]>;

  /** The connections holding this secret in any of `scopes`, at most one per scope. */
  abstract findAllByFingerprint(input: {
    organizationId: string;
    secretFingerprint: string;
    scopes: SlackScope[];
  }): Promise<SlackConnectionRow[]>;

  /** Empty when the scope already holds this fingerprint (the unique index). */
  abstract create(input: {
    record: SlackConnectionRecord;
    actorId: string;
  }): Promise<SlackConnectionRow[]>;

  /** Empty when the new fingerprint or scope collides with another connection. */
  abstract update(input: {
    id: string;
    organizationId: string;
    changes: SlackConnectionChanges;
    actorId: string;
  }): Promise<SlackConnectionRow[]>;

  abstract delete(input: { id: string; organizationId: string }): Promise<void>;
}
