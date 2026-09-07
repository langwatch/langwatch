/**
 * @vitest-environment node
 *
 * The user-default layer end to end against a real database: a default set in
 * the service survives an SDK re-register, a dropped parameter leaves its
 * default stale but stored, and a value the declaration cannot accept is
 * refused without changing what is stored.
 *
 * @see specs/agents/connected-agent-parameter-user-defaults.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConnectedComponentConfig } from "~/optimization_studio/types/dsl";
import { prisma } from "~/server/db";
import { agentParameterDefinitionsOf } from "~/server/suites/connected-targets";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { getTestUser } from "~/utils/testUtils";
import {
  AgentRepository,
  type ConnectedAgentIdentity,
} from "../agent.repository";
import { AgentService, userParameterDefaultsOf } from "../agent.service";
import { staleParameterDefaultNames } from "../parameter-defaults";

const projectId = `test-agent-param-defaults-${nanoid(8)}`;

const service = AgentService.create(prisma);
const repository = new AgentRepository(prisma);

const sdk = { name: "langwatch", version: "1.0.0", language: "python" };

const modelConfig: ConnectedComponentConfig = {
  parameters: [
    {
      name: "model",
      type: "string",
      options: ["gpt-4", "gpt-5"],
      defaultValue: "gpt-4",
    },
  ],
  sdk,
};

/** The identity row the runtime reads, with the user defaults on it. */
async function identityRow(id: string) {
  const [row] = await repository.findManyIncludingArchived({
    ids: [id],
    projectId,
  });
  return row!;
}

function identity(name: string): ConnectedAgentIdentity {
  return {
    environment: "production",
    ownerUserId: null,
    hostLabel: null,
    identityKey: `${name}@production-${nanoid(6)}`,
  };
}

beforeAll(async () => {
  await getTestUser();
  const organization = await prisma.organization.findUnique({
    where: { slug: "test-organization" },
  });
  const team = await prisma.team.findFirst({
    where: { slug: "test-team", organizationId: organization!.id },
  });
  await prisma.project.create({
    data: {
      id: projectId,
      name: projectId,
      slug: projectId,
      apiKey: `sk-lw-${projectId}`,
      teamId: team!.id,
      language: "en",
      framework: "test",
    },
  });
});

afterAll(async () => {
  await cleanupTestRows(prisma, [
    ["agent", { projectId }],
    ["project", { id: projectId }],
  ]);
});

describe("connected agent user parameter defaults", () => {
  describe("when the owner sets a default in the service", () => {
    /** @scenario "A user sets a default value in the drawer and it applies to new runs" */
    it("overlays the user default onto the runtime definitions and returns it", async () => {
      const agent = await service.registerConnected({
        id: `agent_${nanoid()}`,
        projectId,
        name: "sets-default-agent",
        config: modelConfig,
        identity: identity("sets-default-agent"),
      });

      const updated = await service.setParameterDefault({
        id: agent.id,
        projectId,
        name: "model",
        value: "gpt-5",
      });

      expect(userParameterDefaultsOf(updated)).toEqual({ model: "gpt-5" });
      const definitions = agentParameterDefinitionsOf(
        await identityRow(agent.id),
      );
      expect(definitions).toContainEqual(
        expect.objectContaining({ name: "model", defaultValue: "gpt-5" }),
      );
    });
  });

  describe("when the process re-registers with the same schema", () => {
    /** @scenario "An SDK reconnect with the same schema preserves user defaults" */
    it("keeps the user default while the code default is rewritten", async () => {
      const id = `agent_${nanoid()}`;
      const same = identity("reconnect-same-agent");
      await service.registerConnected({
        id,
        projectId,
        name: "reconnect-same-agent",
        config: modelConfig,
        identity: same,
      });
      const agent = await service.registerConnected({
        id,
        projectId,
        name: "reconnect-same-agent",
        config: modelConfig,
        identity: same,
      });
      await service.setParameterDefault({
        id: agent.id,
        projectId,
        name: "model",
        value: "gpt-5",
      });

      await service.registerConnected({
        id: `agent_${nanoid()}`,
        projectId,
        name: "reconnect-same-agent",
        config: modelConfig,
        identity: same,
      });

      const row = await identityRow(agent.id);
      expect(userParameterDefaultsOf(row)).toEqual({ model: "gpt-5" });
      expect(agentParameterDefinitionsOf(row)).toContainEqual(
        expect.objectContaining({ name: "model", defaultValue: "gpt-5" }),
      );
    });
  });

  describe("when the process re-registers without a parameter that has a default", () => {
    /** @scenario "A reconnect with a removed parameter shows the override as stale" */
    it("keeps the stored default, names it stale, and drops it from the runtime definitions", async () => {
      const same = identity("reconnect-drops-agent");
      const withPlan: ConnectedComponentConfig = {
        parameters: [{ name: "plan", type: "string", defaultValue: "free" }],
        sdk,
      };
      const agent = await service.registerConnected({
        id: `agent_${nanoid()}`,
        projectId,
        name: "reconnect-drops-agent",
        config: withPlan,
        identity: same,
      });
      await service.setParameterDefault({
        id: agent.id,
        projectId,
        name: "plan",
        value: "pro",
      });

      await service.registerConnected({
        id: `agent_${nanoid()}`,
        projectId,
        name: "reconnect-drops-agent",
        config: modelConfig,
        identity: same,
      });

      const row = await identityRow(agent.id);
      const userDefaults = userParameterDefaultsOf(row);
      expect(userDefaults).toEqual({ plan: "pro" });
      const definitions = agentParameterDefinitionsOf(row);
      expect(staleParameterDefaultNames({ definitions, userDefaults })).toEqual(
        ["plan"],
      );
      expect(definitions.map((each) => each.name)).not.toContain("plan");
    });
  });

  describe("when the value is outside the declared options", () => {
    /** @scenario "An invalid user-supplied value is rejected at save time" */
    it("refuses the save and stores nothing", async () => {
      const agent = await service.registerConnected({
        id: `agent_${nanoid()}`,
        projectId,
        name: "invalid-default-agent",
        config: {
          parameters: [
            {
              name: "plan",
              type: "string",
              options: ["free", "pro"],
              defaultValue: "free",
            },
          ],
          sdk,
        },
        identity: identity("invalid-default-agent"),
      });

      await expect(
        service.setParameterDefault({
          id: agent.id,
          projectId,
          name: "plan",
          value: "invalid",
        }),
      ).rejects.toMatchObject({
        code: "agent_parameter_default_invalid",
        meta: { name: "plan" },
      });

      const row = await identityRow(agent.id);
      expect(userParameterDefaultsOf(row)).toEqual({});
    });
  });

  describe("when the parameter is a secret", () => {
    /** @scenario "A secret parameter cannot have a user default" */
    it("refuses the save", async () => {
      const agent = await service.registerConnected({
        id: `agent_${nanoid()}`,
        projectId,
        name: "secret-default-agent",
        config: { parameters: [{ name: "token", secret: true }], sdk },
        identity: identity("secret-default-agent"),
      });

      await expect(
        service.setParameterDefault({
          id: agent.id,
          projectId,
          name: "token",
          value: "leaked",
        }),
      ).rejects.toMatchObject({
        code: "agent_parameter_default_invalid",
        meta: { name: "token", reason: "is a secret" },
      });
    });
  });
});
