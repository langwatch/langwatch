// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type AwsConnectionInput,
  awsConnectionInputSchema,
  type AwsConnectionView,
} from "@langwatch/enterprise-governance-contract";
import { generate } from "@langwatch/ksuid";

import type {
  GovernanceAwsConnectionRecord,
  GovernanceAwsConnectionRepository,
} from "../../../repositories/governance-aws-connection.repository.ts";

interface GovernanceAwsConnectionDependencies {
  connections: GovernanceAwsConnectionRepository;
  newId: () => string;
}

/** A read answers the access key id's last four characters and never a secret. */
function viewOfAwsConnection(record: GovernanceAwsConnectionRecord): AwsConnectionView {
  return {
    id: record.id,
    name: record.name,
    accessKeyIdLastFour: record.accessKeyId ? record.accessKeyId.slice(-4) : null,
    roleArn: record.roleArn,
    hasExternalId: record.hasExternalId,
    createdAt: record.createdAt,
  };
}

/**
 * The AWS connections a Bedrock kill switch target signs with: a key pair, a role to assume, or
 * both. The repository seals the secret access key and the external id before they are stored.
 */
export class GovernanceAwsConnectionService {
  private constructor(private readonly deps: GovernanceAwsConnectionDependencies) {}

  static create({
    newId = () => generate("awsconn").toString(),
    ...deps
  }: Omit<GovernanceAwsConnectionDependencies, "newId"> & {
    newId?: () => string;
  }): GovernanceAwsConnectionService {
    return new GovernanceAwsConnectionService({ ...deps, newId });
  }

  async createConnection({
    organizationId,
    connection,
  }: {
    organizationId: string;
    connection: AwsConnectionInput;
  }): Promise<AwsConnectionView> {
    const input = awsConnectionInputSchema.parse(connection);
    const record = await this.deps.connections.create({
      id: this.deps.newId(),
      organizationId,
      name: input.name,
      accessKeyId: input.accessKeyId ?? null,
      secretAccessKey: input.secretAccessKey ?? null,
      roleArn: input.roleArn ?? null,
      externalId: input.externalId ?? null,
    });
    return viewOfAwsConnection(record);
  }

  async findConnections({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AwsConnectionView[]> {
    return (await this.deps.connections.findAll({ organizationId })).map(viewOfAwsConnection);
  }

  async deleteConnection({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<{ deleted: boolean }> {
    return { deleted: await this.deps.connections.delete({ organizationId, id: connectionId }) };
  }
}
