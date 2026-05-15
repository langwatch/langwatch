/**
 * @vitest-environment node
 *
 * Onboarding seed coverage: when a user enables a provider during
 * onboarding, the right role-level ModelDefault rows appear at the
 * chosen scope (and never overwrite existing user choices). See
 * specs/model-providers/model-resolver-and-registry.feature.
 */
import { nanoid } from "nanoid";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../db";
import { seedOnboardingDefaultsForProvider } from "../seedOnboardingDefaults";

const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;

describe.skipIf(isTestcontainersOnly)(
  "seedOnboardingDefaultsForProvider (real DB)",
  () => {
    const ns = `mp-seed-${nanoid(8)}`;

    let organizationId: string;
    let teamId: string;
    let projectId: string;

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: { name: `Seed Org ${ns}`, slug: `--test-${ns}` },
      });
      organizationId = organization.id;

      const team = await prisma.team.create({
        data: {
          name: `Team ${ns}`,
          slug: `--team-${ns}`,
          organizationId,
        },
      });
      teamId = team.id;

      const project = await prisma.project.create({
        data: {
          name: `Project ${ns}`,
          slug: `--proj-${ns}`,
          teamId: team.id,
          language: "typescript",
          framework: "other",
          apiKey: `test-key-${ns}`,
        },
      });
      projectId = project.id;
    });

    afterEach(async () => {
      await prisma.modelDefault.deleteMany({
        where: { scopeType: "ORGANIZATION", scopeId: organizationId },
      });
    });

    async function rowsFor(scopeId: string) {
      return await prisma.modelDefault.findMany({
        where: { scopeType: "ORGANIZATION", scopeId },
        orderBy: { role: "asc" },
      });
    }

    describe("when enabling OpenAI on a fresh organization", () => {
      /** @scenario Enabling OpenAI during onboarding seeds Default, Fast and Embeddings */
      it("seeds Default, Fast and Embeddings rows at org scope", async () => {
        await seedOnboardingDefaultsForProvider({
          prisma,
          provider: "openai",
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
        });

        const rows = await rowsFor(organizationId);
        const byRole = Object.fromEntries(
          rows.map((r) => [r.role, r]),
        );

        expect(byRole.DEFAULT).toBeDefined();
        expect(byRole.DEFAULT!.featureKey).toBeNull();
        expect(byRole.DEFAULT!.model).toMatch(/^openai\/gpt-\d+\.\d+$/);

        expect(byRole.FAST).toBeDefined();
        expect(byRole.FAST!.featureKey).toBeNull();
        expect(byRole.FAST!.model).toMatch(/^openai\/gpt-\d+\.\d+-mini$/);

        expect(byRole.EMBEDDINGS).toBeDefined();
        expect(byRole.EMBEDDINGS!.featureKey).toBeNull();
        expect(byRole.EMBEDDINGS!.model).toMatch(
          /^openai\/text-embedding-/,
        );
      });
    });

    describe("when enabling Anthropic on a fresh organization", () => {
      /** @scenario Enabling Anthropic during onboarding seeds Default and Fast (no embeddings) */
      it("seeds Default and Fast but skips Embeddings", async () => {
        await seedOnboardingDefaultsForProvider({
          prisma,
          provider: "anthropic",
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
        });

        const rows = await rowsFor(organizationId);
        const byRole = Object.fromEntries(rows.map((r) => [r.role, r]));

        expect(byRole.DEFAULT?.model).toMatch(/sonnet/i);
        expect(byRole.FAST?.model).toMatch(/haiku/i);
        expect(byRole.EMBEDDINGS).toBeUndefined();
      });
    });

    describe("when a role already has a row at the target scope", () => {
      /** @scenario Seeding does not overwrite an existing user choice */
      it("preserves the existing model unchanged", async () => {
        await prisma.modelDefault.create({
          data: {
            scopeType: "ORGANIZATION",
            scopeId: organizationId,
            role: "DEFAULT",
            featureKey: null,
            model: "openai/gpt-5.5",
          },
        });

        await seedOnboardingDefaultsForProvider({
          prisma,
          provider: "anthropic",
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
        });

        const rows = await rowsFor(organizationId);
        const def = rows.find((r) => r.role === "DEFAULT")!;
        expect(def.model).toBe("openai/gpt-5.5");
        // Fast was empty before, so the anthropic onboarding fills it.
        const fast = rows.find((r) => r.role === "FAST")!;
        expect(fast.model).toMatch(/haiku/i);
      });
    });
  },
);
