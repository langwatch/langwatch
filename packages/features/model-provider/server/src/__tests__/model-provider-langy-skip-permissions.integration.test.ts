/**
 * @vitest-environment node
 *
 * The skip-permissions list survives a write and a read on the real column.
 *
 * The drawer scenarios are bound in
 * packages/features/model-provider/web/src/ui/sections/__tests__/model-provider-form.skip-permissions.integration.test.tsx;
 * this suite is what proves the JSON column behind them, including the clear that returns a
 * provider to its registry default.
 *
 * @see specs/settings/model-provider-skip-permissions.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { readStoredSkipList } from "@langwatch/model-provider-contract";
import { PrismaModelProviderRepository } from "../repositories/prisma/prisma.model-provider.repository";
import {
  DB_URL,
  IdentityModelProviderCredentialCodec,
  cleanupTenancyFixture,
  createTenancyFixture,
  createTestPrismaClient,
  testNamespace,
  type TenancyFixture,
} from "./support/model-provider-integration.support";

describe.skipIf(!DB_URL)(
  "Feature: the provider row holds the models allowed to skip Langy permission checks",
  () => {
    const prisma: PrismaClient = createTestPrismaClient();
    const repository = PrismaModelProviderRepository.create(
      prisma,
      new IdentityModelProviderCredentialCodec(),
    );
    const ns = testNamespace("mp-skip");
    let fixture: TenancyFixture;
    let seq = 0;

    function row(langySkipPermissionsModels: string[] | null) {
      seq += 1;
      return {
        id: `mp_${ns}_${seq}`,
        organizationId: fixture.organizationId,
        provider: "openai",
        name: `OpenAI skip list ${seq}`,
        enabled: true,
        routingHandle: null,
        scopes: [{ scopeType: "PROJECT" as const, scopeId: fixture.projectId }],
        customKeys: null,
        customModels: [],
        customEmbeddingsModels: [],
        extraHeaders: [],
        rateLimitRpm: null,
        rateLimitTpm: null,
        rateLimitRpd: null,
        fallbackPriorityGlobal: null,
        providerConfig: null,
        langySkipPermissionsModels,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    beforeAll(async () => {
      fixture = await createTenancyFixture(prisma, ns);
    });

    afterAll(async () => {
      await prisma.modelProvider.deleteMany({
        where: { organizationId: fixture.organizationId },
      });
      await cleanupTenancyFixture(prisma, fixture);
      await prisma.$disconnect();
    });

    describe("given a provider saved with two patterns", () => {
      describe("when the row is read back", () => {
        /** @scenario "A stored list replaces the provider default" */
        it("holds both patterns in the order they were written", async () => {
          const created = await repository.create(row(["^gpt-9$", "^gpt-10$"]));

          const found = await repository.tryFindById({
            id: created.id,
            organizationId: fixture.organizationId,
          });

          expect(readStoredSkipList(found?.langySkipPermissionsModels)).toEqual([
            "^gpt-9$",
            "^gpt-10$",
          ]);
        });
      });

      describe("when the list is cleared", () => {
        /** @scenario "Clearing the list returns the provider to its default" */
        it("leaves the column empty, so the provider default applies again", async () => {
          const created = await repository.create(row(["^gpt-9$"]));

          await repository.update({ ...created, langySkipPermissionsModels: null });
          const found = await repository.tryFindById({
            id: created.id,
            organizationId: fixture.organizationId,
          });

          expect(found?.langySkipPermissionsModels).toBeNull();
        });
      });

      describe("when another field is written without naming the list", () => {
        it("keeps the stored list", async () => {
          const created = await repository.create(row(["^gpt-9$"]));

          await repository.update({ ...created, enabled: false });
          const found = await repository.tryFindById({
            id: created.id,
            organizationId: fixture.organizationId,
          });

          expect(readStoredSkipList(found?.langySkipPermissionsModels)).toEqual(["^gpt-9$"]);
        });
      });
    });
  },
);
