// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** What a read answers about a connection: never the secret access key or the external id. */
export type GovernanceAwsConnectionRecord = {
  id: string;
  organizationId: string;
  name: string;
  accessKeyId: string | null;
  roleArn: string | null;
  hasExternalId: boolean;
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
 * external id are sealed with the process cipher before they reach the store.
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
  /** Whether a row was deleted. */
  abstract delete(input: { organizationId: string; id: string }): Promise<boolean>;
}
