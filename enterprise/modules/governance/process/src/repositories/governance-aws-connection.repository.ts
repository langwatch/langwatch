// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AuditLogIntent } from "@langwatch/audit-log-contract";

/** What a read answers about a connection: never the secret access key. */
export type GovernanceAwsConnectionRecord = {
  id: string;
  organizationId: string;
  name: string;
  accessKeyId: string | null;
  roleArn: string | null;
  /** Opened from its seal: the role's trust policy names it, so a read shows it. */
  externalId: string | null;
  createdAt: string;
};

/** The opened credentials, for one Bedrock call only. */
export type GovernanceAwsCredentials = {
  accessKeyId: string | null;
  secretAccessKey: string | null;
  roleArn: string | null;
  externalId: string | null;
};

/**
 * The AWS connections a Bedrock kill switch target signs with. The secret access key and the
 * external id are sealed with the process cipher before they reach the store. A create or delete
 * appends its `audit` intent to the kill switch audit outbox in the same commit.
 */
export abstract class GovernanceAwsConnectionRepository {
  abstract create(input: {
    id: string;
    organizationId: string;
    name: string;
    accessKeyId: string | null;
    secretAccessKey: string | null;
    roleArn: string | null;
    externalId: string | null;
    audit: AuditLogIntent;
  }): Promise<GovernanceAwsConnectionRecord>;
  abstract findAll(input: { organizationId: string }): Promise<GovernanceAwsConnectionRecord[]>;
  /** The connections of the organisation among `ids`; another organisation's id is left out. */
  abstract findByIds(input: {
    organizationId: string;
    ids: readonly string[];
  }): Promise<GovernanceAwsConnectionRecord[]>;
  /** Throws `governance_aws_connection_not_found` for an id outside the organisation. */
  abstract getCredentials(input: {
    organizationId: string;
    id: string;
  }): Promise<GovernanceAwsCredentials>;
  /**
   * Whether a row was deleted; the audit intent is appended only with a deletion. `whileLocked`
   * runs under `awsConnectionsLockKey` right before the delete; a throw keeps the row.
   */
  abstract delete(input: {
    organizationId: string;
    id: string;
    audit: AuditLogIntent;
    whileLocked?: () => Promise<void>;
  }): Promise<boolean>;
}
