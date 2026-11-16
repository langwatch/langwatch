// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The kill switch tables in Postgres: stop plans, sealed AWS connections, open-stop claims and
 * the AgentStop projection. Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { randomBytes } from "node:crypto";

import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { createTenantId } from "@langwatch/eventing";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { aesEncryption } from "@langwatch/process-stores";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import {
  type AgentStopRecord,
  requestedStop,
} from "../../../features/kill-switch/rules/agent-stop.rules.ts";
import { virtualKey } from "../../../features/kill-switch/services/__tests__/kill-switch.fixtures.ts";
import { AgentStopPlanService } from "../../../features/kill-switch/services/agent-stop-plan.service.ts";
import { AgentStopService } from "../../../features/kill-switch/services/agent-stop.service.ts";
import { planRegistryChanges } from "../../../features/registry/rules/registry-reconcile.rules.ts";
import { MemoryGovernanceRepositories } from "../../memory/memory.governance.repositories.ts";
import { PrismaAgentStopClaimRepository } from "../prisma.agent-stop-claim.repository.ts";
import { PrismaAgentStopPlanRepository } from "../prisma.agent-stop-plan.repository.ts";
import { PrismaAgentStopRepository } from "../prisma.agent-stop.repository.ts";
import { PrismaGovernanceAwsConnectionRepository } from "../prisma.governance-aws-connection.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const connection = DB_URL
  ? PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:governance:test:kill-switch"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL, log: ["error"] }))
  : undefined;

const AGENT_ID = "agent-support-bot";

async function seedRegistry({
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

describe.skipIf(!connection)("the kill switch Prisma repositories", () => {
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

  afterAll(async () => {
    const where = { organizationId: { in: organizations } };
    await prisma().agentStopPlanTarget.deleteMany({ where });
    await prisma().governanceAwsConnection.deleteMany({ where });
    await prisma().agentStop.deleteMany({ where });
    await prisma().agentStopClaim.deleteMany({ where });
  });

  /** The api side of a stop over Postgres; `send` records the commands and runs no worker. */
  async function stopServiceOf(organizationId: string) {
    const memory = MemoryGovernanceRepositories.create();
    await seedRegistry({ memory, organizationId });
    await memory.agentStopPlans.replaceTargets({
      organizationId,
      agentId: AGENT_ID,
      targets: [
        {
          id: "target-vk",
          label: "Virtual key vk-support-bot",
          target: { kind: "gateway_virtual_key", virtualKeyId: "vk-support-bot" },
        },
      ],
    });
    const sent: string[] = [];
    let ids = 0;
    const service = AgentStopService.create({
      stops: PrismaAgentStopRepository.create(prisma()),
      claims: PrismaAgentStopClaimRepository.create(prisma()),
      plans: AgentStopPlanService.create({
        plans: memory.agentStopPlans,
        registry: memory.agentRegistry,
        sources: memory.ingestionSources,
        awsConnections: awsConnections(),
        virtualKeys: createApiFixture<GatewayApi>(),
      }),
      registry: memory.agentRegistry,
      auditLog: createApiFixture<AuditLogApi>({
        record: async () => ({ id: "audit", occurredAt: 0 }),
      }),
      send: async (name) => {
        sent.push(name);
      },
      newId: () => `agentstop-${ns}-${organizationId.slice(-2)}-${++ids}`,
    });
    const request = () =>
      service.requestStop({
        organizationId,
        agentId: AGENT_ID,
        reason: "data exfiltration attempt",
        severity: "critical",
        caller: { userId: "user-ops", apiKeyId: null },
      });
    return { service, sent, request };
  }

  /** Writes the stop's row as the worker's projection would, in `status`. */
  async function projectStop({
    organizationId,
    stopId,
    status,
  }: {
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

  describe("when two stop requests for one agent arrive at the same moment", () => {
    /** @scenario "Two stop requests at the same moment open one stop" */
    it("opens exactly one stop and refuses the other with agent_stop_already_open", async () => {
      const organizationId = newOrganization();
      const { sent, request } = await stopServiceOf(organizationId);

      const outcomes = await Promise.allSettled([request(), request(), request()]);

      const opened = outcomes.filter((outcome) => outcome.status === "fulfilled");
      const refused = outcomes.flatMap((outcome) =>
        outcome.status === "rejected" ? [(outcome.reason as { code?: string }).code] : [],
      );
      expect(opened).toHaveLength(1);
      expect(refused).toEqual(["agent_stop_already_open", "agent_stop_already_open"]);
      expect(sent).toEqual(["request"]);
      const claims = await prisma().agentStopClaim.findMany({ where: { organizationId } });
      expect(claims.map((claim) => claim.stopId)).toEqual([
        opened[0]?.status === "fulfilled" ? opened[0].value.id : "none",
      ]);
    });
  });

  describe("when the agent's open stop has closed", () => {
    it("lets the next request take the claim over", async () => {
      const organizationId = newOrganization();
      const { request } = await stopServiceOf(organizationId);
      const first = await request();
      await projectStop({ organizationId, stopId: first.id, status: "quarantined" });
      await expect(request()).rejects.toMatchObject({ code: "agent_stop_already_open" });

      await projectStop({ organizationId, stopId: first.id, status: "restored" });
      const second = await request();

      expect(second.id).not.toBe(first.id);
      const claims = await prisma().agentStopClaim.findMany({ where: { organizationId } });
      expect(claims.map((claim) => claim.stopId)).toEqual([second.id]);
    });
  });

  describe("given a Databricks governance source and an AWS connection in the organisation", () => {
    /** @scenario "A stop plan holds a Databricks serving endpoint, a Bedrock agent alias and a virtual key" */
    it("stores the three targets in order and reads them back", async () => {
      const organizationId = newOrganization();
      const memory = MemoryGovernanceRepositories.create();
      await seedRegistry({ memory, organizationId });
      const source = await memory.ingestionSources.create({
        organizationId,
        teamId: null,
        traceProjectId: null,
        sourceType: "databricks_genie",
        name: "Databricks",
        description: null,
        ingestSecretHash: "unused",
        parserConfig: {
          adapter: "databricks_genie",
          workspaceUrl: "https://acme.cloud.databricks.com",
          credentials: { token: "dapi-token" },
        },
        pullSchedule: null,
        status: "awaiting_first_event",
        createdById: "user-ops",
        providerAccountId: null,
      });
      const aws = await awsConnections().create({
        id: `awsconn-${ns}-plan`,
        organizationId,
        name: "ACME production",
        accessKeyId: "AKIAACMEEXAMPLE0001",
        secretAccessKey: "acme-secret",
        roleArn: null,
        externalId: null,
      });
      let ids = 0;
      const plans = AgentStopPlanService.create({
        plans: PrismaAgentStopPlanRepository.create(prisma()),
        registry: memory.agentRegistry,
        sources: memory.ingestionSources,
        awsConnections: awsConnections(),
        virtualKeys: createApiFixture<GatewayApi>({
          findVirtualKeyById: async (id, organization) =>
            organization === organizationId ? virtualKey(id) : null,
        }),
        newId: () => `stoptarget-${ns}-${++ids}`,
      });

      await plans.setPlan({
        organizationId,
        agentId: "agent-support-bot",
        targets: [
          {
            kind: "databricks_serving_endpoint",
            ingestionSourceId: source.id,
            endpointName: "support-bot-prod",
          },
          {
            kind: "bedrock_agent_alias",
            awsConnectionId: aws.id,
            region: "eu-west-1",
            agentId: "AGENT00001",
            agentAliasId: "ALIAS00001",
          },
          { kind: "gateway_virtual_key", virtualKeyId: "vk-support-bot" },
        ],
      });
      const plan = await plans.getPlan({ organizationId, agentId: "agent-support-bot" });

      expect(plan.targets.map((target) => target.target.kind)).toEqual([
        "databricks_serving_endpoint",
        "bedrock_agent_alias",
        "gateway_virtual_key",
      ]);
      expect(await plans.findPlanCounts({ organizationId })).toEqual([
        { agentId: "agent-support-bot", targetCount: 3 },
      ]);
    });
  });

  describe("when an AWS connection is stored", () => {
    it("seals the secret key and the external id and reads them back only through getCredentials", async () => {
      const organizationId = newOrganization();
      const stored = await awsConnections().create({
        id: `awsconn-${ns}-sealed`,
        organizationId,
        name: "ACME role",
        accessKeyId: "AKIAACMEEXAMPLE0002",
        secretAccessKey: "acme-secret-two",
        roleArn: "arn:aws:iam::123456789012:role/kill-switch",
        externalId: "acme-external-id",
      });
      const row = await prisma().governanceAwsConnection.findFirstOrThrow({
        where: { organizationId, id: stored.id },
      });

      expect(JSON.stringify(row)).not.toContain("acme-secret-two");
      expect(JSON.stringify(row)).not.toContain("acme-external-id");
      expect(stored.hasExternalId).toBe(true);
      expect(await awsConnections().getCredentials({ organizationId, id: stored.id })).toEqual({
        accessKeyId: "AKIAACMEEXAMPLE0002",
        secretAccessKey: "acme-secret-two",
        roleArn: "arn:aws:iam::123456789012:role/kill-switch",
        externalId: "acme-external-id",
      });
      expect(
        await awsConnections().delete({ organizationId: newOrganization(), id: stored.id }),
      ).toBe(false);
      expect(await awsConnections().findAll({ organizationId })).toHaveLength(1);
    });
  });

  describe("when the AgentStop projection stores a stop", () => {
    it("reads it back by id, agent and status, and only inside its organisation", async () => {
      const organizationId = newOrganization();
      const repository = PrismaAgentStopRepository.create(prisma());
      const stop = requestedStop({
        data: {
          stopId: `agentstop-${ns}`,
          organizationId,
          agentId: "agent-support-bot",
          agentName: "support-bot",
          severity: "high",
          approval: "required",
          trigger: "api_key",
          reason: "cost spike",
          requestedByUserId: "user-owner",
          requestedByApiKeyId: "key-trace-rule",
          targets: [
            {
              id: "target-vk",
              label: "Virtual key vk-support-bot",
              target: { kind: "gateway_virtual_key", virtualKeyId: "vk-support-bot" },
            },
          ],
        },
        at: Date.parse("2026-11-16T10:00:00Z"),
      });
      const at = Date.parse("2026-11-16T10:00:00Z");

      await repository.store(
        {
          state: stop,
          cursor: { acceptedAt: at, eventId: "event-1" },
          occurredAt: at,
          createdAt: at,
          updatedAt: at,
          version: "2026-11-16",
        },
        { tenantId: createTenantId(organizationId), aggregateId: stop.id },
      );

      expect(await repository.getStop({ organizationId, stopId: stop.id })).toEqual(stop);
      expect(
        (
          await repository.findByStatuses({ organizationId, statuses: [stop.status], limit: 10 })
        ).map((each) => each.id),
      ).toEqual([stop.id]);
      expect(
        await repository.findByAgent({ organizationId, agentId: "agent-support-bot", limit: 10 }),
      ).toHaveLength(1);
      await expect(
        repository.getStop({ organizationId: newOrganization(), stopId: stop.id }),
      ).rejects.toMatchObject({ code: "agent_stop_not_found" });
    });
  });
});
