// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { randomBytes } from "node:crypto";

import type { AuditLogIntent } from "@langwatch/audit-log-contract";
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
import type { KillSwitchAuditService } from "./kill-switch-audit.service.ts";

interface GovernanceAwsConnectionDependencies {
  connections: GovernanceAwsConnectionRepository;
  plans: Pick<AgentStopPlanRepository, "findAgentIdsByAwsConnection">;
  stops: Pick<AgentStopRepository, "findAllByStatuses">;
  audit: Pick<KillSwitchAuditService, "intentOf">;
  newId: () => string;
  newExternalId: () => string;
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
    externalId: record.externalId,
    createdAt: record.createdAt,
  };
}

/** A stop that may still sign with its connections: open, or waiting for a restore. */
const STOP_STATUSES_HOLDING_CONNECTIONS = [
  ...new Set([...AGENT_STOP_OPEN_STATUSES, ...AGENT_STOP_RESTORABLE_STATUSES]),
];

/**
 * The AWS connections a Bedrock kill switch target signs with: a key pair, a role to assume, or
 * both. A role always gets an external id LangWatch generates, never one the caller picks. The
 * repository seals the secret access key and the external id before they are stored. A
 * connection a plan target or an unrestored stop still names cannot be deleted. Adding and removing
 * one writes an audit row.
 */
export class GovernanceAwsConnectionService {
  private constructor(private readonly deps: GovernanceAwsConnectionDependencies) {}

  static create({
    newId = () => generate("awsconn").toString(),
    newExternalId = () => `langwatch-${randomBytes(24).toString("base64url")}`,
    ...deps
  }: Omit<GovernanceAwsConnectionDependencies, "newId" | "newExternalId"> & {
    newId?: () => string;
    newExternalId?: () => string;
  }): GovernanceAwsConnectionService {
    return new GovernanceAwsConnectionService({ ...deps, newId, newExternalId });
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
    const id = this.deps.newId();
    // Confused deputy guard: only LangWatch picks the id the role's trust policy must match.
    const externalId = input.roleArn ? this.deps.newExternalId() : null;
    const record = await this.deps.connections.create({
      id,
      organizationId,
      name: input.name,
      accessKeyId: input.accessKeyId ?? null,
      secretAccessKey: input.secretAccessKey ?? null,
      roleArn: input.roleArn ?? null,
      externalId,
      audit: this.auditOf({
        action: "governance.agent.aws_connection_created",
        organizationId,
        userId,
        connectionId: id,
        metadata: {
          targetName: input.name,
          name: input.name,
          accessKeyIdLastFour: input.accessKeyId ? input.accessKeyId.slice(-4) : null,
          roleArn: input.roleArn ?? null,
          hasExternalId: externalId !== null,
        },
      }),
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
    const [named] = await this.deps.connections.findByIds({ organizationId, ids: [connectionId] });
    const deleted = await this.deps.connections.delete({
      organizationId,
      id: connectionId,
      audit: this.auditOf({
        action: "governance.agent.aws_connection_deleted",
        organizationId,
        userId,
        connectionId,
        metadata: named ? { targetName: named.name } : {},
      }),
    });
    return { deleted };
  }

  /** The write's audit row, keyed once; the repository commits it with the write. */
  private auditOf({
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
  }): AuditLogIntent {
    return this.deps.audit.intentOf({
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
