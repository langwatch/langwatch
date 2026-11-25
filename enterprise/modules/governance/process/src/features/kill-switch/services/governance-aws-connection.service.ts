// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { randomBytes } from "node:crypto";

import type { AuditLogEntry, AuditLogIntent } from "@langwatch/audit-log-contract";
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
  audit: Pick<KillSwitchAuditService, "intentOf" | "record">;
  newId: () => string;
  newExternalId: () => string;
}

/** The audit target of a connection write; the row never carries the secret or external id. */
const AWS_CONNECTION_AUDIT_TARGET_KIND = "governance_aws_connection";

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

type AuditEntryInput = {
  action: string;
  organizationId: string;
  userId: string | null;
  impersonatorId?: string;
  connectionId: string;
  metadata: Record<string, string | boolean | null>;
};

/** A connection write's audit row; an impersonated person's operator is named as the generic trail names it. */
function auditEntryOf({
  action,
  organizationId,
  userId,
  impersonatorId,
  connectionId,
  metadata,
}: AuditEntryInput): AuditLogEntry {
  return {
    ...(userId ? { userId } : {}),
    ...(impersonatorId ? { actorUserId: impersonatorId } : {}),
    organizationId,
    action,
    targetKind: AWS_CONNECTION_AUDIT_TARGET_KIND,
    targetId: connectionId,
    metadata: { ...metadata, ...(impersonatorId ? { impersonatorId } : {}) },
  };
}

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
    impersonatorId,
  }: {
    organizationId: string;
    connection: AwsConnectionInput;
    userId: string | null;
    impersonatorId?: string;
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
        impersonatorId,
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
    impersonatorId,
  }: {
    organizationId: string;
    connectionId: string;
    userId: string | null;
    impersonatorId?: string;
  }): Promise<{ deleted: boolean }> {
    const [named] = await this.deps.connections.findByIds({ organizationId, ids: [connectionId] });
    const deleted = await this.deps.connections.delete({
      organizationId,
      id: connectionId,
      audit: this.auditOf({
        action: "governance.agent.aws_connection_deleted",
        organizationId,
        userId,
        impersonatorId,
        connectionId,
        metadata: named ? { targetName: named.name } : {},
      }),
      // Under the lock a plan write naming a Bedrock target takes, so no plan names it meanwhile.
      whileLocked: () =>
        this.refuseWhileInUse({ organizationId, connectionId, userId, impersonatorId }),
    });
    return { deleted };
  }

  private async refuseWhileInUse({
    organizationId,
    connectionId,
    userId,
    impersonatorId,
  }: {
    organizationId: string;
    connectionId: string;
    userId: string | null;
    impersonatorId: string | undefined;
  }): Promise<void> {
    const agentIds = await this.findAgentIdsUsing({ organizationId, connectionId });
    if (agentIds.length > 0) {
      const refusal = new GovernanceAwsConnectionInUseError({ connectionId, agentIds });
      // The transport leaves this call out of the generic trail, so the refused attempt is ours.
      await this.deps.audit.record({
        ...auditEntryOf({
          action: "governance.agent.aws_connection_deleted",
          organizationId,
          userId,
          impersonatorId,
          connectionId,
          metadata: {},
        }),
        error: refusal.code,
      });
      throw refusal;
    }
  }

  /** The write's audit row, keyed once; the repository commits it with the write. */
  private auditOf(entry: AuditEntryInput): AuditLogIntent {
    return this.deps.audit.intentOf(auditEntryOf(entry));
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
