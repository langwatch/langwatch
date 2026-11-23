import type { PrismaClient } from "@langwatch/prisma-client/generated";
/**
 * Real Postgres: Langy's narrow write of `modelsAllowed` onto its own product-managed keys.
 * @vitest-environment node
 * Spec: specs/langy/langy-model-allowlist.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGatewayTestPrismaConnection } from "../app/__tests__/gateway-prisma.fixture.ts";
import { createTraceDestinationProjects } from "./support/trace-destination-project-service.ts";
import { PostgresVirtualKeyAdapter } from "./testing.ts";

const { createVirtualKeyServiceForTest } = PostgresVirtualKeyAdapter;

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl ? createGatewayTestPrismaConnection(databaseUrl) : null;
const prisma = connection?.client as PrismaClient;

const suffix = nanoid(8);
const ORG_ID = `org-langyma-${suffix}`;
const TEAM_ID = `team-langyma-${suffix}`;
const PROJECT_ID = `proj-langyma-${suffix}`;
const OTHER_PROJECT_ID = `proj-langyma-other-${suffix}`;
const USER_ID = `usr-langyma-${suffix}`;

const GUARDED_CONFIG = {
  modelsAllowed: null,
  rateLimits: { rpm: 60, tpm: null, rpd: null },
  metadata: { tags: ["langy"] },
};

describe.skipIf(!databaseUrl)("Langy's models written onto its own keys (real PG)", () => {
  const service = createVirtualKeyServiceForTest(prisma, createTraceDestinationProjects(prisma));

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: ORG_ID, name: `LANGYMA ${suffix}`, slug: `langyma-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `LANGYMA Team ${suffix}`,
        slug: `langyma-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    for (const id of [PROJECT_ID, OTHER_PROJECT_ID]) {
      await prisma.project.create({
        data: {
          id,
          name: `LANGYMA ${id}`,
          slug: id,
          teamId: TEAM_ID,
          language: "en",
          framework: "openai",
          apiKey: `key-${id}`,
        },
      });
    }
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@langyma.local`, name: "Admin" },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.gatewayChangeEvent.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.auditLog.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.project.deleteMany({ where: { teamId: TEAM_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  });

  async function mintKey({
    purpose,
    projectId = PROJECT_ID,
  }: {
    purpose: "USER" | "LANGY";
    projectId?: string;
  }) {
    const { virtualKey } = await service.create({
      organizationId: ORG_ID,
      name: `${purpose}-${nanoid(6)}`,
      scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
      actorUserId: USER_ID,
      purpose,
    });
    await prisma.virtualKey.update({
      where: { id: virtualKey.id },
      data: { config: GUARDED_CONFIG },
    });
    return virtualKey;
  }

  async function stored(id: string) {
    return prisma.virtualKey.findUniqueOrThrow({ where: { id } });
  }

  function save(modelsAllowed: string[] | null, projectId = PROJECT_ID) {
    return service.setLangyModelsAllowedInternal({
      organizationId: ORG_ID,
      projectId,
      modelsAllowed,
      actorUserId: USER_ID,
    });
  }

  async function retireLangyKeys() {
    await prisma.virtualKey.updateMany({
      where: { organizationId: ORG_ID, purpose: "LANGY" },
      data: { status: "REVOKED" },
    });
  }

  describe("when a project admin saves two models", () => {
    /** @scenario "A project admin saves the models Langy may use" */
    it("writes exactly those models, tells the gateways and audits the change", async () => {
      await retireLangyKeys();
      const langyKey = await mintKey({ purpose: "LANGY" });
      const before = await stored(langyKey.id);

      const { virtualKeyIds } = await save(["openai/gpt-5", "anthropic/claude-sonnet-4-5"]);

      const after = await stored(langyKey.id);
      expect(virtualKeyIds).toEqual([langyKey.id]);
      expect(after.config).toMatchObject({
        modelsAllowed: ["openai/gpt-5", "anthropic/claude-sonnet-4-5"],
      });
      expect(after.revision).toBe(before.revision + 1n);
      const changes = await prisma.gatewayChangeEvent.findMany({
        where: { organizationId: ORG_ID, virtualKeyId: langyKey.id, kind: "VK_CONFIG_UPDATED" },
      });
      expect(changes).toHaveLength(1);
      const audits = await prisma.auditLog.findMany({
        where: { organizationId: ORG_ID, targetId: langyKey.id },
      });
      expect(audits.map((row) => [row.action, row.projectId, row.userId])).toContainEqual([
        "gateway.virtual_key.updated",
        PROJECT_ID,
        USER_ID,
      ]);
    });
  });

  describe("when a project admin clears the list", () => {
    /** @scenario "Clearing the list lets Langy use every model again" */
    it("stores no allowlist, which allows every model", async () => {
      await retireLangyKeys();
      const langyKey = await mintKey({ purpose: "LANGY" });
      await save(["openai/gpt-5"]);

      await save(null);

      expect((await stored(langyKey.id)).config).toMatchObject({ modelsAllowed: null });
    });
  });

  describe("when the list is saved", () => {
    /** @scenario "Saving the list never changes the Langy key's secret or visibility" */
    it("keeps the secret, the rest of the config, and the key out of customer listings", async () => {
      await retireLangyKeys();
      const langyKey = await mintKey({ purpose: "LANGY" });
      const before = await stored(langyKey.id);

      await save(["openai/gpt-5"]);

      const after = await stored(langyKey.id);
      expect(after.hashedSecret).toBe(before.hashedSecret);
      expect(after.displayPrefix).toBe(before.displayPrefix);
      expect(after.status).toBe("ACTIVE");
      expect(after.config).toEqual({ ...GUARDED_CONFIG, modelsAllowed: ["openai/gpt-5"] });
      const listed = await service.getAll(ORG_ID);
      expect(listed.map((key) => key.id)).not.toContain(langyKey.id);
      await expect(service.findById(langyKey.id, ORG_ID)).resolves.toBeNull();
    });
  });

  describe("given a project holding two live Langy keys", () => {
    /** @scenario "Every live Langy key of the project carries the list" */
    it("writes the list onto both", async () => {
      await retireLangyKeys();
      const first = await mintKey({ purpose: "LANGY" });
      const second = await mintKey({ purpose: "LANGY" });

      const { virtualKeyIds } = await save(["openai/gpt-5"]);

      expect(virtualKeyIds.toSorted()).toEqual([first.id, second.id].toSorted());
      for (const id of [first.id, second.id]) {
        expect((await stored(id)).config).toMatchObject({ modelsAllowed: ["openai/gpt-5"] });
      }
    });
  });

  describe("given a customer key and another project's Langy key", () => {
    /** @scenario "The list never reaches a key that is not the project's Langy key" */
    it("leaves both untouched", async () => {
      await retireLangyKeys();
      const customerKey = await mintKey({ purpose: "USER" });
      const otherProjectKey = await mintKey({ purpose: "LANGY", projectId: OTHER_PROJECT_ID });
      const beforeCustomer = await stored(customerKey.id);
      const beforeOther = await stored(otherProjectKey.id);

      const { virtualKeyIds } = await save(["openai/gpt-5"]);

      expect(virtualKeyIds).toEqual([]);
      expect(await stored(customerKey.id)).toEqual(beforeCustomer);
      expect(await stored(otherProjectKey.id)).toEqual(beforeOther);
    });
  });
});
