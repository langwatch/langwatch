// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AuditLogApi } from "@langwatch/audit-log-contract";
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
  stops: Pick<AgentStopRepository, "findAllByStatuses">;
  auditLog: Pick<AuditLogApi, "record">;
  newId: () => string;
}

/** The audit target of a connection write; the row never carries the secret or external id. */
export const AWS_CONNECTION_AUDIT_TARGET_KIND = "governance_aws_connection";

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
 * connection a plan target or an unrestored stop still names cannot be deleted. Adding and removing
 * one writes an audit row.
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
    userId,
  }: {
    organizationId: string;
    connection: AwsConnectionInput;
    userId: string | null;
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
    const view = viewOfAwsConnection(record);
    await this.audit({
      action: "governance.agent.aws_connection_created",
      organizationId,
      userId,
      connectionId: view.id,
      metadata: {
        name: view.name,
        accessKeyIdLastFour: view.accessKeyIdLastFour,
        roleArn: view.roleArn,
        hasExternalId: view.hasExternalId,
      },
    });
    return view;
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
    userId,
  }: {
    organizationId: string;
    connectionId: string;
    userId: string | null;
  }): Promise<{ deleted: boolean }> {
    const agentIds = await this.findAgentIdsUsing({ organizationId, connectionId });
    if (agentIds.length > 0) {
      throw new GovernanceAwsConnectionInUseError({ connectionId, agentIds });
    }
    const deleted = await this.deps.connections.delete({ organizationId, id: connectionId });
    if (deleted) {
      await this.audit({
        action: "governance.agent.aws_connection_deleted",
        organizationId,
        userId,
        connectionId,
        metadata: {},
      });
    }
    return { deleted };
  }

  private async audit({
    action,
    organizationId,
    userId,
    connectionId,
    metadata,
  }: {
    action: string;
    organizationId: string;
    userId: string | null;
    connectionId: string;
    metadata: Record<string, string | boolean | null>;
  }): Promise<void> {
    await this.deps.auditLog.record({
      ...(userId ? { userId } : {}),
      organizationId,
      action,
      targetKind: AWS_CONNECTION_AUDIT_TARGET_KIND,
      targetId: connectionId,
      metadata,
    });
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
      this.deps.stops.findAllByStatuses({
        organizationId,
        statuses: STOP_STATUSES_HOLDING_CONNECTIONS,
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
