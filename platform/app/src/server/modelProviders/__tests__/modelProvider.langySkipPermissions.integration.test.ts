/**
 * @vitest-environment node
 *
 * The skip-permissions list survives a write and a read on the real column.
 *
 * The drawer scenarios are bound in
 * src/components/settings/__tests__/ModelProviderForm.skip-permissions.integration.test.tsx;
 * this suite is what proves the JSON column behind them, including the clear
 * that returns a provider to its registry default.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getTestProject, getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { readStoredSkipList } from "../langySkipPermissions";
import { ModelProviderRepository } from "../modelProvider.repository";
import { ModelProviderService } from "../modelProvider.service";

let projectId: string;

describe("Feature: the provider row holds the models allowed to skip Langy permission checks", () => {
  const repository = new ModelProviderRepository(prisma);
  const createdProviderIds: string[] = [];

  beforeAll(async () => {
    await getTestUser();
    const project = await getTestProject("modelprovider-skip-permissions");
    projectId = project.id;
  });

  afterAll(async () => {
    if (createdProviderIds.length > 0) {
      await prisma.modelProvider.deleteMany({
        where: { id: { in: createdProviderIds } },
      });
    }
  });

  describe("given a provider saved with two patterns", () => {
    describe("when the row is read back", () => {
      it("holds both patterns in the order they were written", async () => {
        const created = await repository.create({
          name: "OpenAI skip list",
          provider: "openai",
          enabled: true,
          scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
          langySkipPermissionsModels: ["^gpt-9$", "^gpt-10$"],
        });
        createdProviderIds.push(created.id);

        const found = await repository.findById(created.id, projectId);

        expect(readStoredSkipList(found?.langySkipPermissionsModels)).toEqual([
          "^gpt-9$",
          "^gpt-10$",
        ]);
      });
    });

    describe("when the list is cleared", () => {
      it("leaves the column empty, so the provider default applies again", async () => {
        const created = await repository.create({
          name: "OpenAI cleared skip list",
          provider: "openai",
          enabled: true,
          scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
          langySkipPermissionsModels: ["^gpt-9$"],
        });
        createdProviderIds.push(created.id);

        await repository.update(created.id, {
          langySkipPermissionsModels: null,
        });
        const found = await repository.findById(created.id, projectId);

        expect(found?.langySkipPermissionsModels).toBeNull();
      });
    });

    describe("when the drawer reads the project's providers back", () => {
      it("carries the list, so reopening the drawer shows what was saved", async () => {
        const created = await repository.create({
          name: "OpenAI listed skip list",
          provider: "openai",
          enabled: true,
          scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
          langySkipPermissionsModels: ["^gpt-9$", "^gpt-10$"],
        });
        createdProviderIds.push(created.id);

        const rows =
          await ModelProviderService.create(
            prisma,
          ).listProjectModelProvidersForFrontend(projectId);

        expect(
          rows.find((row) => row.id === created.id)?.langySkipPermissionsModels,
        ).toEqual(["^gpt-9$", "^gpt-10$"]);
      });
    });

    describe("when another field is written without naming the list", () => {
      it("keeps the stored list", async () => {
        const created = await repository.create({
          name: "OpenAI untouched skip list",
          provider: "openai",
          enabled: true,
          scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
          langySkipPermissionsModels: ["^gpt-9$"],
        });
        createdProviderIds.push(created.id);

        await repository.update(created.id, { enabled: false });
        const found = await repository.findById(created.id, projectId);

        expect(readStoredSkipList(found?.langySkipPermissionsModels)).toEqual([
          "^gpt-9$",
        ]);
      });
    });
  });
});
