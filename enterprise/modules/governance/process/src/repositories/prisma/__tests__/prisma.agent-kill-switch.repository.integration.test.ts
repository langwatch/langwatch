// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The kill switch tables in Postgres: stop plans, sealed AWS connections and the AgentStop
 * projection. Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { randomBytes } from "node:crypto";

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

import { requestedStop } from "../../../features/kill-switch/rules/agent-stop.rules.ts";
import { virtualKey } from "../../../features/kill-switch/services/__tests__/kill-switch.fixtures.ts";
import { AgentStopPlanService } from "../../../features/kill-switch/services/agent-stop-plan.service.ts";
import { planRegistryChanges } from "../../../features/registry/rules/registry-reconcile.rules.ts";
import { MemoryGovernanceRepositories } from "../../memory/memory.governance.repositories.ts";
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
  });

  describe("given a Databricks governance source and an AWS connection in the organisation", () => {
    /** @scenario "A stop plan holds a Databricks serving endpoint, a Bedrock agent alias and a virtual key" */
    it("stores the three targets in order and reads them back", async () => {
      const organizationId = newOrganization();
      const memory = MemoryGovernanceRepositories.create();
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
            newId: () => "agent-support-bot",
          }),
        baselineAt: Temporal.Instant.from("2026-11-01T00:00:00Z"),
      });
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
