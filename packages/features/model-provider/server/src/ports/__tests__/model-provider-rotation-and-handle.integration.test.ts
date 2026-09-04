/**
 * @vitest-environment node
 *
 * Two rules that only a real Postgres can settle, exercised through the real
 * repository.
 *
 * The routing handle is the name that addresses ONE model provider instance in
 * a gateway model string. The unique index over (organizationId, routingHandle)
 * is what actually makes the name unique inside an organization, so a mock that
 * agreed with whatever the repository believed would prove nothing.
 *
 * The change feed is how a credential rotation reaches a running gateway: every
 * write appends MODEL_PROVIDER_UPDATED, the gateway's change poller evicts every
 * cached bundle naming that provider, and the next request re-materialises.
 *
 * Spec: specs/ai-gateway/instance-routing-handle.feature
 *       specs/ai-gateway/governance/provider-credential-rotation.feature
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ModelProvider } from "@langwatch/model-provider-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ModelProviderCredentialCodec } from "../model-provider.port";
import { PrismaModelProviderRepository } from "../../repositories/prisma/prisma.model-provider.repository";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

class Credentials extends ModelProviderCredentialCodec {
  encode(value: Record<string, unknown> | null): unknown {
    return value === null ? null : JSON.stringify(value);
  }

  tryDecode(value: unknown): Record<string, unknown> | null {
    return typeof value === "string" ? JSON.parse(value) : null;
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const suffix = randomBytes(5).toString("hex");
const ORG_ID = `org-mph-${suffix}`;
const OTHER_ORG_ID = `org-mph-other-${suffix}`;

const repository = () => PrismaModelProviderRepository.create(prisma, new Credentials());

function row(overrides: Partial<ModelProvider> & { id: string }): ModelProvider {
  const organizationId = overrides.organizationId ?? ORG_ID;
  return {
    organizationId,
    provider: "openai",
    name: overrides.id,
    enabled: true,
    routingHandle: null,
    customKeys: { OPENAI_API_KEY: "fake-key" },
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
    ...overrides,
  } as ModelProvider;
}

/** Change-feed rows an organization produced, newest last. */
async function changeEvents(organizationId: string) {
  return await prisma.gatewayChangeEvent.findMany({
    where: { organizationId },
    orderBy: { revision: "asc" },
    select: { kind: true, modelProviderId: true },
  });
}

async function clearChangeEvents(organizationId: string) {
  await prisma.gatewayChangeEvent.deleteMany({ where: { organizationId } });
}

describe.skipIf(!databaseUrl)("model provider rows against real Postgres", () => {
  beforeAll(async () => {
    for (const [id, label] of [
      [ORG_ID, "primary"],
      [OTHER_ORG_ID, "other"],
    ] as const) {
      await prisma.organization.create({
        data: { id, name: `Handle Org ${label} ${suffix}`, slug: `mph-${label}-${suffix}` },
      });
    }
  }, 120_000);

  afterAll(async () => {
    for (const id of [ORG_ID, OTHER_ORG_ID]) {
      await prisma.gatewayChangeEvent.deleteMany({ where: { organizationId: id } });
      await prisma.modelProvider.deleteMany({ where: { organizationId: id } });
      await prisma.organization.deleteMany({ where: { id } });
    }
    await connection?.closeOnce();
  }, 120_000);

  describe("given a handle already taken inside one organization", () => {
    /** @scenario "Two providers in one organization cannot share a handle" */
    it("refuses the second write with a routing-handle conflict", async () => {
      const repo = repository();
      await repo.create(row({ id: `mp-eu-${suffix}`, routingHandle: "eu" }));

      let refusal: unknown;
      try {
        await repo.create(row({ id: `mp-eu2-${suffix}`, routingHandle: "eu" }));
      } catch (error) {
        refusal = error;
      }

      // The unique index is what refuses, and the repository is what names the
      // refusal as a handle conflict rather than any other constraint.
      expect(refusal).toBeDefined();
      expect(repo.isRoutingHandleConflict(refusal)).toBe(true);
      expect(
        await prisma.modelProvider.count({
          where: { organizationId: ORG_ID, routingHandle: "eu" },
        }),
      ).toBe(1);
    });

    /** @scenario "Two organizations can use the same handle" */
    it("lets another organization use the same name", async () => {
      const created = await repository().create(
        row({
          id: `mp-other-eu-${suffix}`,
          organizationId: OTHER_ORG_ID,
          routingHandle: "eu",
        }),
      );

      const stored = await prisma.modelProvider.findUnique({
        where: { id: created.id },
        select: { routingHandle: true, organizationId: true },
      });
      expect(stored?.routingHandle).toBe("eu");
      expect(stored?.organizationId).toBe(OTHER_ORG_ID);
    });
  });

  describe("when a handle is renamed", () => {
    /** @scenario "A renamed handle no longer resolves under its old name" */
    it("stops answering to the old name and frees it for another provider", async () => {
      const repo = repository();
      const provider = await repo.create(
        row({ id: `mp-rename-${suffix}`, routingHandle: "before" }),
      );

      await repo.update(row({ id: provider.id, routingHandle: "after" }));

      const stored = await prisma.modelProvider.findUnique({
        where: { id: provider.id },
        select: { routingHandle: true },
      });
      expect(stored?.routingHandle).toBe("after");

      // The old name is free again, which is the same thing as saying it no
      // longer resolves to this provider.
      const reuser = await repo.create(
        row({ id: `mp-rename-reuse-${suffix}`, routingHandle: "before" }),
      );
      const reused = await prisma.modelProvider.findUnique({
        where: { id: reuser.id },
        select: { routingHandle: true },
      });
      expect(reused?.routingHandle).toBe("before");
    });
  });

  describe("when a provider is created", () => {
    /** @scenario "Creating a provider evicts the gateway configuration" */
    it("appends MODEL_PROVIDER_UPDATED so the handle resolves immediately", async () => {
      await clearChangeEvents(ORG_ID);

      const created = await repository().create(row({ id: `mp-create-evict-${suffix}` }));

      expect(await changeEvents(ORG_ID)).toEqual([
        { kind: "MODEL_PROVIDER_UPDATED", modelProviderId: created.id },
      ]);
    });
  });

  describe("when a stored credential is replaced", () => {
    /** @scenario "replacing a stored credential tells the gateway to drop its copy" */
    it("appends MODEL_PROVIDER_UPDATED", async () => {
      const repo = repository();
      const created = await repo.create(row({ id: `mp-rotate-${suffix}` }));
      await clearChangeEvents(ORG_ID);

      await repo.update(row({ id: created.id, customKeys: { OPENAI_API_KEY: "fake-rotated" } }));

      expect(await changeEvents(ORG_ID)).toEqual([
        { kind: "MODEL_PROVIDER_UPDATED", modelProviderId: created.id },
      ]);
    });
  });

  describe("when a provider is disabled", () => {
    /** @scenario "disabling a provider tells the gateway to drop its copy" */
    it("appends MODEL_PROVIDER_UPDATED", async () => {
      const repo = repository();
      const created = await repo.create(row({ id: `mp-disable-${suffix}` }));
      await clearChangeEvents(ORG_ID);

      await repo.update(row({ id: created.id, enabled: false }));

      expect(await changeEvents(ORG_ID)).toEqual([
        { kind: "MODEL_PROVIDER_UPDATED", modelProviderId: created.id },
      ]);
      const stored = await prisma.modelProvider.findUnique({
        where: { id: created.id },
        select: { enabled: true },
      });
      expect(stored?.enabled).toBe(false);
    });
  });

  describe("when a provider is deleted", () => {
    /** @scenario "deleting a provider tells the gateway to drop its copy" */
    it("appends MODEL_PROVIDER_UPDATED", async () => {
      const repo = repository();
      const created = await repo.create(row({ id: `mp-delete-${suffix}` }));
      await clearChangeEvents(ORG_ID);

      await repo.delete({ id: created.id, organizationId: ORG_ID });

      expect(await changeEvents(ORG_ID)).toEqual([
        { kind: "MODEL_PROVIDER_UPDATED", modelProviderId: created.id },
      ]);
      expect(await prisma.modelProvider.findUnique({ where: { id: created.id } })).toBeNull();
    });
  });
});
