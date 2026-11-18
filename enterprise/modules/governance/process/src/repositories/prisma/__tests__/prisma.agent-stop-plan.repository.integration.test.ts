// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Stop plans and sealed AWS connections in Postgres.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import type { AuditLogIntent } from "@langwatch/audit-log-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { generate } from "@langwatch/ksuid";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterAll, describe, expect, it } from "vitest";

import { virtualKey } from "../../../features/kill-switch/services/__tests__/kill-switch.fixtures.ts";
import { AgentStopPlanService } from "../../../features/kill-switch/services/agent-stop-plan.service.ts";
import { MemoryGovernanceRepositories } from "../../memory/memory.governance.repositories.ts";
import { PrismaAgentStopPlanRepository } from "../prisma.agent-stop-plan.repository.ts";
import {
  AGENT_ID,
  connection,
  killSwitchDatabase,
  presentPlatforms,
  seedRegistry,
} from "./prisma.kill-switch.fixtures.ts";

/** The audit intent a connection write commits with. */
const auditOf = (organizationId: string, action: string): AuditLogIntent => ({
  idempotencyKey: generate("audit").toString(),
  organizationId,
  action,
});

describe.skipIf(!connection)("the kill switch plan and AWS connection repositories", () => {
  const { ns, newOrganization, prisma, awsConnections, cleanup } = killSwitchDatabase();

  afterAll(cleanup);

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
        audit: auditOf(organizationId, "governance.agent.aws_connection_created"),
      });
      let ids = 0;
      const plans = AgentStopPlanService.create({
        plans: PrismaAgentStopPlanRepository.create(prisma()),
        registry: memory.agentRegistry,
        sources: memory.ingestionSources,
        awsConnections: awsConnections(),
        ...presentPlatforms({ memory }),
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
        audit: auditOf(organizationId, "governance.agent.aws_connection_created"),
      });
      const row = await prisma().governanceAwsConnection.findFirstOrThrow({
        where: { organizationId, id: stored.id },
      });

      expect(JSON.stringify(row)).not.toContain("acme-secret-two");
      expect(JSON.stringify(row)).not.toContain("acme-external-id");
      expect(stored.externalId).toBe("acme-external-id");
      expect(await awsConnections().getCredentials({ organizationId, id: stored.id })).toEqual({
        accessKeyId: "AKIAACMEEXAMPLE0002",
        secretAccessKey: "acme-secret-two",
        roleArn: "arn:aws:iam::123456789012:role/kill-switch",
        externalId: "acme-external-id",
      });
      expect(
        await awsConnections().delete({
          organizationId: newOrganization(),
          id: stored.id,
          audit: auditOf(organizationId, "governance.agent.aws_connection_deleted"),
        }),
      ).toBe(false);
      expect(await awsConnections().findAll({ organizationId })).toHaveLength(1);
    });
  });

  describe("when two plan writes for one agent run at once", () => {
    /** @scenario "Two plan writes at once leave one whole plan" */
    it("leaves the rows of exactly one write", async () => {
      const organizationId = newOrganization();
      const plans = PrismaAgentStopPlanRepository.create(prisma());
      const write = (prefix: string) =>
        plans.replaceTargets({
          organizationId,
          agentId: AGENT_ID,
          targets: [1, 2].map((n) => ({
            id: `${prefix}-${ns}-${n}`,
            label: `Virtual key vk-${n}`,
            target: { kind: "gateway_virtual_key" as const, virtualKeyId: `vk-${n}` },
          })),
        });

      await Promise.all([write("a"), write("b"), write("c")]);

      const stored = await plans.findTargets({ organizationId, agentId: AGENT_ID });
      expect(stored).toHaveLength(2);
      expect(new Set(stored.map((target) => target.id.split("-")[0])).size).toBe(1);
    });
  });

  describe("when a plan target signs with an AWS connection", () => {
    it("finds the agent by the connection's id", async () => {
      const organizationId = newOrganization();
      const plans = PrismaAgentStopPlanRepository.create(prisma());
      await plans.replaceTargets({
        organizationId,
        agentId: AGENT_ID,
        targets: [
          {
            id: `bedrock-${ns}`,
            label: "Bedrock alias",
            target: {
              kind: "bedrock_agent_alias",
              awsConnectionId: `awsconn-${ns}-used`,
              region: "eu-west-1",
              agentId: "AGENT00001",
              agentAliasId: "ALIAS00001",
            },
          },
        ],
      });

      const used = { organizationId, awsConnectionId: `awsconn-${ns}-used` };
      expect(await plans.findAgentIdsByAwsConnection(used)).toEqual([AGENT_ID]);
      expect(
        await plans.findAgentIdsByAwsConnection({ ...used, awsConnectionId: "awsconn-other" }),
      ).toEqual([]);
    });
  });

  /** The plan service over Postgres plans and connections, for an organisation with a registry. */
  async function planServiceOf(organizationId: string) {
    const memory = MemoryGovernanceRepositories.create();
    await seedRegistry({ memory, organizationId });
    let ids = 0;
    return AgentStopPlanService.create({
      plans: PrismaAgentStopPlanRepository.create(prisma()),
      registry: memory.agentRegistry,
      sources: memory.ingestionSources,
      awsConnections: awsConnections(),
      ...presentPlatforms({ memory }),
      virtualKeys: createApiFixture<GatewayApi>({
        findVirtualKeyById: async (id, organization) =>
          organization === organizationId ? virtualKey(id) : null,
      }),
      newId: () => `stoptarget-${ns}-${organizationId.slice(-2)}-${++ids}`,
    });
  }

  const keyTarget = (virtualKeyId: string) => ({
    kind: "gateway_virtual_key" as const,
    virtualKeyId,
  });

  describe("when two people save a plan they read at the same version", () => {
    /** @scenario "A plan saved over one someone else saved since is refused" */
    it("refuses the second save and keeps the first one's targets and version", async () => {
      const organizationId = newOrganization();
      const plans = await planServiceOf(organizationId);
      const read = await plans.getPlan({ organizationId, agentId: AGENT_ID });
      expect(read.version).toBe(0);

      const first = await plans.setPlan({
        organizationId,
        agentId: AGENT_ID,
        targets: [keyTarget("vk-first")],
        expectedVersion: read.version,
      });
      const refusal = await plans
        .setPlan({
          organizationId,
          agentId: AGENT_ID,
          targets: [keyTarget("vk-second")],
          expectedVersion: read.version,
        })
        .catch((error: unknown) => error);

      expect(first.version).toBe(1);
      expect(refusal).toMatchObject({
        code: "agent_stop_plan_conflict",
        httpStatus: 409,
        meta: { agentId: AGENT_ID, expectedVersion: 0, version: 1 },
      });
      const kept = await plans.getPlan({ organizationId, agentId: AGENT_ID });
      expect(kept.version).toBe(1);
      expect(kept.targets.map(({ target }) => target)).toEqual([keyTarget("vk-first")]);
    });

    it("keeps counting across a cleared plan, so an old read cannot overwrite it", async () => {
      const organizationId = newOrganization();
      const plans = await planServiceOf(organizationId);
      await plans.setPlan({ organizationId, agentId: AGENT_ID, targets: [keyTarget("vk-a")] });
      const cleared = await plans.setPlan({ organizationId, agentId: AGENT_ID, targets: [] });

      expect(cleared).toMatchObject({ version: 2, targets: [] });
      expect(cleared.updatedAt).not.toBeNull();
      const refusal = await plans
        .setPlan({
          organizationId,
          agentId: AGENT_ID,
          targets: [keyTarget("vk-b")],
          expectedVersion: 0,
        })
        .catch((error: unknown) => error);
      expect(refusal).toMatchObject({ code: "agent_stop_plan_conflict" });
    });
  });

  describe("when a connection delete and a plan save naming it run at once", () => {
    /** @scenario "Deleting an AWS connection and saving a plan that names it never interleave" */
    it("holds the plan save until the delete commits, then refuses it", async () => {
      const organizationId = newOrganization();
      const plans = await planServiceOf(organizationId);
      const aws = await awsConnections().create({
        id: `awsconn-${ns}-race`,
        organizationId,
        name: "ACME production",
        accessKeyId: "AKIAACMEEXAMPLE0003",
        secretAccessKey: "acme-secret-three",
        roleArn: null,
        externalId: null,
        audit: auditOf(organizationId, "governance.agent.aws_connection_created"),
      });
      let saving: Promise<unknown> | undefined;
      let duringDelete: string | undefined;

      const deleted = await awsConnections().delete({
        organizationId,
        id: aws.id,
        audit: auditOf(organizationId, "governance.agent.aws_connection_deleted"),
        whileLocked: async () => {
          saving = plans
            .setPlan({
              organizationId,
              agentId: AGENT_ID,
              targets: [
                {
                  kind: "bedrock_agent_alias",
                  awsConnectionId: aws.id,
                  region: "eu-west-1",
                  agentId: "AGENT00001",
                  agentAliasId: "ALIAS00001",
                },
              ],
            })
            .catch((error: unknown) => error);
          duringDelete = await Promise.race([
            saving.then(() => "saved"),
            new Promise<string>((resolve) => setTimeout(() => resolve("waiting"), 500)),
          ]);
        },
      });

      expect(deleted).toBe(true);
      expect(duringDelete).toBe("waiting");
      expect(await saving).toMatchObject({ code: "agent_stop_target_invalid" });
      expect(
        await PrismaAgentStopPlanRepository.create(prisma()).findTargets({
          organizationId,
          agentId: AGENT_ID,
        }),
      ).toEqual([]);
    });
  });
});
