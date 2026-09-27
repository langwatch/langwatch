/**
 * The org-level tag routes of the prompts REST family: what a caller gets back when they
 * list, create and delete a custom prompt tag.
 * @see specs/features/prompts/custom-prompt-tags.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { PrismaClient, PromptTag } from "@langwatch/prisma-client/generated";
import type { PromptApi } from "@langwatch/prompt-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { beforeEach, describe, expect, it } from "vitest";

import { PrismaPromptTagRepository } from "../../repositories/prisma/prisma.prompt-tag.repository.ts";
import type { PromptTagDatabase } from "../../repositories/prisma/prisma.prompt-tag.repository.ts";
import { PromptTagCatalogueService } from "../../services/prompt-tag-catalogue.service.ts";
import { PromptTagService } from "../../services/prompt-tag.service.ts";
import type { PromptService } from "../../services/prompt.service.ts";
import { mountPromptRest, PROMPT_TEST_ORGANIZATION } from "./prompt-rest.harness.ts";

/** The unique-constraint failure Prisma raises on (organizationId, name). */
class DuplicateTagError extends Error {
  readonly code = "P2002";
}

/**
 * The tag table, in memory: enough of `promptTag` for the repository, plus the
 * two tables its delete-by-name transaction sweeps.
 */
function inMemoryTagDatabase(): PromptTagDatabase {
  const rows: PromptTag[] = [];
  let clock = 0;

  const matches = (row: PromptTag, where: unknown) =>
    typeof where !== "object" ||
    where === null ||
    Object.entries(where).every(([key, value]) => row[key as keyof PromptTag] === value);
  const clashes = (write: TagWrite) =>
    rows.some((row) => row.organizationId === write.organizationId && row.name === write.name);

  const promptTag = {
    create: ({ data }: { data: unknown }) => {
      if (!isTagWrite(data)) return Promise.reject(new Error("unexpected tag write"));
      if (clashes(data)) return Promise.reject(new DuplicateTagError("Unique constraint failed"));
      const row = storedTag({ write: data, at: ++clock });
      rows.push(row);
      return Promise.resolve(row);
    },
    createMany: (args?: { data?: unknown; skipDuplicates?: boolean }) => {
      const entries = Array.isArray(args?.data) ? args.data : [args?.data];
      for (const entry of entries) {
        if (!isTagWrite(entry)) return Promise.reject(new Error("unexpected tag write"));
        if (clashes(entry) && args?.skipDuplicates) continue;
        if (clashes(entry)) {
          return Promise.reject(new DuplicateTagError("Unique constraint failed"));
        }
        rows.push(storedTag({ write: entry, at: ++clock }));
      }
      return Promise.resolve({ count: entries.length });
    },
    findMany: (args?: { where?: unknown }) =>
      Promise.resolve(
        rows
          .filter((row) => matches(row, args?.where))
          .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      ),
    findFirst: (args?: { where?: unknown }) =>
      Promise.resolve(rows.find((row) => matches(row, args?.where)) ?? null),
    delete: (args: { where?: unknown }) => {
      const at = rows.findIndex((row) => matches(row, args.where));
      return Promise.resolve(at === -1 ? null : rows.splice(at, 1)[0]);
    },
    deleteMany: (args?: { where?: unknown }) => {
      const kept = rows.filter((row) => !matches(row, args?.where));
      const count = rows.length - kept.length;
      rows.splice(0, rows.length, ...kept);
      return Promise.resolve({ count });
    },
  };

  const client: PrismaClient = prismaDouble({
    promptTag,
    project: { findMany: () => Promise.resolve([]) },
    promptTagAssignment: { deleteMany: () => Promise.resolve({ count: 0 }) },
    $transaction: (run: (tx: PrismaClient) => Promise<unknown>) => run(client),
  });

  return client;
}

type TagWrite = { id: string; organizationId: string; name: string; createdById?: unknown };

function isTagWrite(value: unknown): value is TagWrite {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "organizationId" in value &&
    typeof value.organizationId === "string" &&
    "name" in value &&
    typeof value.name === "string"
  );
}

/** A tag row as the table stores it, from the data a write carried. */
function storedTag({ write, at }: { write: TagWrite; at: number }): PromptTag {
  return {
    id: write.id,
    organizationId: write.organizationId,
    name: write.name,
    createdAt: new Date(at),
    updatedAt: new Date(at),
    createdById: typeof write.createdById === "string" ? write.createdById : null,
    updatedById: null,
  };
}

function buildApi() {
  const repository = PrismaPromptTagRepository.create({ prisma: inMemoryTagDatabase() });
  const tags = PromptTagService.create(repository);

  // The three tag operations the routes reach, over the real tag catalogue the
  // application forwards to; the credential check is the application's own.
  const catalogue = PromptTagCatalogueService.create({
    prompts: createApiFixture<PromptService>({
      createTag: (input: { organizationId: string; name: string }) => tags.create(input),
      deleteTagByName: (input: { organizationId: string; name: string }) =>
        tags.deleteByName(input),
    }),
  });
  const app = createApiFixture<PromptApi>({
    listTags: (input: { organizationId: string }) => tags.getAll(input),
    createTagDefinition: (input: { organizationId: string; name: string }) =>
      catalogue.createTagDefinition(input),
    deleteTagDefinition: ({ organizationId, name }: { organizationId: string; name: string }) =>
      catalogue.deleteTagDefinition({ organizationId, name }),
  });

  const family = mountPromptRest({ app });

  return {
    repository,
    listTagNames: async (): Promise<string[]> => {
      const response = await family.request("/api/prompts/tags");
      const body = (await response.json()) as { name: string }[];
      return body.map((tag) => tag.name);
    },
    createTag: (name: string) =>
      family.request("/api/prompts/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    deleteTag: (name: string) => family.request(`/api/prompts/tags/${name}`, { method: "DELETE" }),
  };
}

describe("the prompt tag routes", () => {
  let api: ReturnType<typeof buildApi>;

  beforeEach(async () => {
    api = buildApi();
    await api.repository.seedForOrg({ organizationId: PROMPT_TEST_ORGANIZATION });
  });

  describe('given an organization with the seeded "production" and "staging" tags', () => {
    describe("when the caller deletes a seeded tag", () => {
      /** @scenario 'Deleting the seeded "production" tag succeeds' */
      it("answers 204 and drops production from the org tag list", async () => {
        expect((await api.deleteTag("production")).status).toBe(204);
        expect(await api.listTagNames()).not.toContain("production");
      });

      /** @scenario 'Deleting the seeded "staging" tag succeeds' */
      it("answers 204 and drops staging from the org tag list", async () => {
        expect((await api.deleteTag("staging")).status).toBe(204);
        expect(await api.listTagNames()).not.toContain("staging");
      });
    });

    describe("when the caller recreates a seeded tag it had deleted", () => {
      /** @scenario 'Recreating "production" after deletion succeeds' */
      it("answers 201 and puts production back in the org tag list", async () => {
        await api.deleteTag("production");

        expect((await api.createTag("production")).status).toBe(201);
        expect(await api.listTagNames()).toContain("production");
      });
    });

    describe("when the caller creates a custom tag", () => {
      /** @scenario "Creating a custom tag" */
      it("answers 201 and puts the tag in the org tag list", async () => {
        expect((await api.createTag("canary")).status).toBe(201);
        expect(await api.listTagNames()).toContain("canary");
      });
    });

    describe("when the caller creates a tag that already exists", () => {
      /** @scenario "Creating a duplicate tag returns 409" */
      it("answers 409", async () => {
        await api.createTag("canary");

        expect((await api.createTag("canary")).status).toBe(409);
      });
    });

    describe('when the caller creates the protected tag "latest"', () => {
      /** @scenario 'Creating "latest" via the API returns 422' */
      it("answers 422 and says the name is protected", async () => {
        const response = await api.createTag("latest");

        expect(response.status).toBe(422);
        expect(await response.text()).toContain("protected");
      });
    });
  });
});
