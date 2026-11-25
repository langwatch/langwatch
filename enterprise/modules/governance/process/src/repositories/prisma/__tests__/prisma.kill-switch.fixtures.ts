// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The Postgres connection, registry seed and per-suite organisations the kill switch suites share. */
import { randomBytes } from "node:crypto";

import { createTenantId } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { aesEncryption } from "@langwatch/process-stores";
import { Temporal } from "@langwatch/time";
import { nanoid } from "nanoid";

import { MemoryBedrockAgentAliasChannel } from "../../../channels/memory/memory.bedrock-agent-alias.channel.ts";
import { MemoryDatabricksServingEndpointChannel } from "../../../channels/memory/memory.databricks-serving-endpoint.channel.ts";
import { MemoryProviderSignInChannel } from "../../../channels/memory/memory.provider-sign-in.channel.ts";
import { SourceCredentialAccessService } from "../../../features/ingestion-source/services/source-credential-access.service.ts";
import {
  type AgentStopRecord,
  requestedStop,
} from "../../../features/kill-switch/rules/agent-stop.rules.ts";
import { planRegistryChanges } from "../../../features/registry/rules/registry-reconcile.rules.ts";
import type { MemoryGovernanceRepositories } from "../../memory/memory.governance.repositories.ts";
import { PrismaAgentStopRepository } from "../prisma.agent-stop.repository.ts";
import { PrismaGovernanceAwsConnectionRepository } from "../prisma.governance-aws-connection.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

export const connection = DB_URL
  ? PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:governance:test:kill-switch"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL, log: ["error"] }))
  : undefined;

export const AGENT_ID = "agent-support-bot";

export async function seedRegistry({
  memory,
  organizationId,
}: {
  memory: ReturnType<typeof MemoryGovernanceRepositories.create>;
  organizationId: string;
}): Promise<void> {
  await memory.agentRegistry.applyChanges({
    organizationId,
    plan: (stored) =>
      planRegistryChanges({
        stored,
        drafts: [
          {
            sourceKey: "langwatch:support-bot",
            source: "langwatch",
            management: "managed",
            shadow: false,
            dormant: false,
            platform: null,
            labels: {},
            owner_label: null,
            kind: "signature",
            name: "support-bot",
            description: null,
            source_version: null,
            project_id: "project-1",
            environment: null,
            owner: null,
            endpoints: [],
            model: null,
            instructions: null,
            capabilities: ["signature"],
            tools: [],
            firstSeenAt: Temporal.Instant.from("2026-11-01T00:00:00Z"),
            lastSeenAt: null,
          },
        ],
        now: Temporal.Instant.from("2026-11-01T00:00:00Z"),
        newId: () => AGENT_ID,
      }),
    baselineAt: Temporal.Instant.from("2026-11-01T00:00:00Z"),
  });
}

/** Platforms in memory where every target the suites name exists: the alias AGENT00001/ALIAS00001. */
export function presentPlatforms({
  memory,
}: {
  memory: ReturnType<typeof MemoryGovernanceRepositories.create>;
}) {
  const bedrock = MemoryBedrockAgentAliasChannel.create();
  bedrock.seed({
    agentId: "AGENT00001",
    agentAliasId: "ALIAS00001",
    alias: {
      agentAliasName: "live",
      description: undefined,
      routingConfiguration: [{ agentVersion: "1" }],
      aliasInvocationState: "ACCEPT_INVOCATIONS",
    },
  });
  return {
    sourceCredentials: SourceCredentialAccessService.create({ sources: memory.ingestionSources }),
    signIn: MemoryProviderSignInChannel.create(),
    servingEndpoints: MemoryDatabricksServingEndpointChannel.create(),
    bedrock,
  };
}

/** One suite's namespace, organisations and repositories; `cleanup` drops every row it wrote. */
export function killSwitchDatabase() {
  const ns = `kill-switch-${nanoid(8)}`;
  const organizations: string[] = [];
  const newOrganization = () => {
    const organizationId = `org-${ns}-${organizations.length}`;
    organizations.push(organizationId);
    return organizationId;
  };
  const prisma = () => {
    if (!connection) throw new Error("no test database");
    return connection.client;
  };
  const cipher = aesEncryption(randomBytes(32));
  const awsConnections = () =>
    PrismaGovernanceAwsConnectionRepository.create({ database: prisma(), cipher });
  const cleanup = async () => {
    const where = { organizationId: { in: organizations } };
    await prisma().agentStopPlanTarget.deleteMany({ where });
    await prisma().agentStopPlan.deleteMany({ where });
    await prisma().governanceAwsConnection.deleteMany({ where });
    await prisma().agentStop.deleteMany({ where });
    await prisma().agentStopClaim.deleteMany({ where });
    await prisma().agentStopTargetPriorState.deleteMany({ where });
  };
  return { ns, newOrganization, prisma, awsConnections, cleanup };
}

/** Writes the stop's row as the worker's projection would, in `status`. */
export async function projectStop({
  prisma,
  organizationId,
  stopId,
  status,
}: {
  prisma: () => NonNullable<typeof connection>["client"];
  organizationId: string;
  stopId: string;
  status: AgentStopRecord["status"];
}): Promise<void> {
  const at = Date.parse("2026-11-16T10:00:00Z");
  const stop = requestedStop({
    data: {
      stopId,
      organizationId,
      agentId: AGENT_ID,
      agentName: "support-bot",
      severity: "critical",
      approval: "immediate",
      trigger: "user",
      reason: "data exfiltration attempt",
      requestedByUserId: "user-ops",
      requestedByApiKeyId: null,
      targets: [
        {
          id: "target-vk",
          label: "Virtual key vk-support-bot",
          target: { kind: "gateway_virtual_key", virtualKeyId: "vk-support-bot" },
        },
      ],
    },
    at,
  });
  await PrismaAgentStopRepository.create(prisma()).store(
    {
      state: { ...stop, status },
      cursor: { acceptedAt: at, eventId: `event-${stopId}` },
      occurredAt: at,
      createdAt: at,
      updatedAt: at,
      version: "2026-11-16",
    },
    { tenantId: createTenantId(organizationId), aggregateId: stopId },
  );
}
