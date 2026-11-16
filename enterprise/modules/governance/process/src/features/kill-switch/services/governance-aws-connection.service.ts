// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  AGENT_STOP_OPEN_STATUSES,
  AGENT_STOP_RESTORABLE_STATUSES,
  type AwsConnectionInput,
  awsConnectionInputSchema,
  type AwsConnectionView,
  GovernanceAwsConnectionInUseError,
} from "@langwatch/enterprise-governance-contract";
import { generate } from "@langwatch/ksuid";

import type { AgentStopPlanRepository } from "../../../repositories/agent-stop-plan.repository.ts";
import type { AgentStopRepository } from "../../../repositories/agent-stop.repository.ts";
import type {
  GovernanceAwsConnectionRecord,
  GovernanceAwsConnectionRepository,
} from "../../../repositories/governance-aws-connection.repository.ts";

interface GovernanceAwsConnectionDependencies {
  connections: GovernanceAwsConnectionRepository;
  plans: Pick<AgentStopPlanRepository, "findAgentIdsByAwsConnection">;
  stops: Pick<AgentStopRepository, "findByStatuses">;
  newId: () => string;
}

const STOPS_READ_LIMIT = 500;

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

/** A stop that may still sign with its connections: open, or waiting for a restore. */
const STOP_STATUSES_HOLDING_CONNECTIONS = [
  ...new Set([...AGENT_STOP_OPEN_STATUSES, ...AGENT_STOP_RESTORABLE_STATUSES]),
];

/**
 * The AWS connections a Bedrock kill switch target signs with: a key pair, a role to assume, or
 * both. The repository seals the secret access key and the external id before they are stored. A
 * connection a plan target or an unrestored stop still names cannot be deleted.
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
    const agentIds = await this.findAgentIdsUsing({ organizationId, connectionId });
    if (agentIds.length > 0) {
      throw new GovernanceAwsConnectionInUseError({ connectionId, agentIds });
    }
    return { deleted: await this.deps.connections.delete({ organizationId, id: connectionId }) };
  }

  private async findAgentIdsUsing({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<string[]> {
    const [planned, stops] = await Promise.all([
      this.deps.plans.findAgentIdsByAwsConnection({
        organizationId,
        awsConnectionId: connectionId,
      }),
      this.deps.stops.findByStatuses({
        organizationId,
        statuses: STOP_STATUSES_HOLDING_CONNECTIONS,
        limit: STOPS_READ_LIMIT,
      }),
    ]);
    const stopped = stops
      .filter((stop) =>
        stop.targets.some(
          ({ target }) =>
            target.kind === "bedrock_agent_alias" && target.awsConnectionId === connectionId,
        ),
      )
      .map((stop) => stop.agentId);
    return [...new Set([...planned, ...stopped])].toSorted();
  }
}
