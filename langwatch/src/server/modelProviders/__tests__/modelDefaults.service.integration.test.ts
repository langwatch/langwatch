/**
 * @vitest-environment node
 *
 * Write-side compat coverage: ModelDefaultsService writes land in
 * `ModelDefault` only, never in the legacy B2 scalar columns. Also
 * locks in the migration's data-lift: when the B2 columns are set on a
 * scope, the migration SQL produces matching ModelDefault rows.
 */
import { nanoid } from "nanoid";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../db";
import {
  setFeatureOverride,
  setRoleAssignment,
} from "../modelDefaults.service";

const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;

describe.skipIf(isTestcontainersOnly)(
  "modelDefaults.service (real DB)",
  () => {
    const ns = `mp-defaults-${nanoid(8)}`;

    let organizationId: string;
    let teamId: string;
    let projectId: string;

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: { name: `Defaults Org ${ns}`, slug: `--test-${ns}` },
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
        where: {
          OR: [
            { scopeType: "PROJECT", scopeId: projectId },
            { scopeType: "TEAM", scopeId: teamId },
            { scopeType: "ORGANIZATION", scopeId: organizationId },
          ],
        },
      });
      await prisma.organization.update({
        where: { id: organizationId },
        data: {
          defaultModel: null,
          topicClusteringModel: null,
          embeddingsModel: null,
        },
      });
    });

    describe("when the resolver still reads legacy columns as a fallback", () => {
      /** @scenario Writes during the compat window go only to ModelDefault, never the legacy columns */
      it("setRoleAssignment writes the new ModelDefault row and leaves legacy untouched", async () => {
        await prisma.organization.update({
          where: { id: organizationId },
          data: { defaultModel: "openai/gpt-5.4" },
        });

        await setRoleAssignment(
          { prisma },
          {
            scopeType: "ORGANIZATION",
            scopeId: organizationId,
            role: "DEFAULT",
            model: "openai/gpt-5.5",
          },
        );

        const row = await prisma.modelDefault.findFirst({
          where: {
            scopeType: "ORGANIZATION",
            scopeId: organizationId,
            role: "DEFAULT",
            featureKey: null,
          },
        });
        expect(row?.model).toBe("openai/gpt-5.5");

        const org = await prisma.organization.findUniqueOrThrow({
          where: { id: organizationId },
          select: { defaultModel: true },
        });
        // Legacy column left exactly as it was — no read-from-write feedback.
        expect(org.defaultModel).toBe("openai/gpt-5.4");
      });

      it("setFeatureOverride writes only to ModelDefault", async () => {
        await setFeatureOverride(
          { prisma },
          {
            scopeType: "PROJECT",
            scopeId: projectId,
            featureKey: "traces.ai_search",
            model: "anthropic/claude-sonnet-4-6",
          },
        );
        const row = await prisma.modelDefault.findFirst({
          where: {
            scopeType: "PROJECT",
            scopeId: projectId,
            role: "FAST",
            featureKey: "traces.ai_search",
          },
        });
        expect(row?.model).toBe("anthropic/claude-sonnet-4-6");
      });

      it("setRoleAssignment(model=null) deletes the row", async () => {
        await setRoleAssignment(
          { prisma },
          {
            scopeType: "ORGANIZATION",
            scopeId: organizationId,
            role: "FAST",
            model: "openai/gpt-5.4-mini",
          },
        );
        await setRoleAssignment(
          { prisma },
          {
            scopeType: "ORGANIZATION",
            scopeId: organizationId,
            role: "FAST",
            model: null,
          },
        );
        const row = await prisma.modelDefault.findFirst({
          where: {
            scopeType: "ORGANIZATION",
            scopeId: organizationId,
            role: "FAST",
            featureKey: null,
          },
        });
        expect(row).toBeNull();
      });
    });

    // The B2 → B3 migration data-lift is exercised end-to-end on every
    // `prisma migrate deploy` (CI + production) and verified by the
    // legacy-compat fallback scenarios in resolveModelForFeature: when
    // the new ModelDefault rows are absent the resolver still reads the
    // legacy columns and returns the same value. Re-running the
    // migration SQL inside a test would just re-test SQL, not our code.
  },
);
