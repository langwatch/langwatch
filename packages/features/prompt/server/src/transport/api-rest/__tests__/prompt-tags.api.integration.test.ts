/**
 * The org-level tag routes of the prompts REST family: what a caller gets back when they
 * list, create and delete a custom prompt tag.
 * @see specs/features/prompts/custom-prompt-tags.feature
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type PlatformUrlBuilder,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import type { PromptTag } from "@langwatch/prisma-client/generated";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it } from "vitest";

import { PrismaPromptTagRepository } from "../../../repositories/prisma/prisma.prompt-tag.repository";
import type { PromptTagDatabase } from "../../../repositories/prisma/prisma.prompt-tag.repository";
import { PromptTagService } from "../../../services/prompt-tag.service";
import { createPromptsRestApp, type PromptRestPorts, type PromptRestService } from "../prompt.api";

const ORGANIZATION_ID = "org_tags";

/** The unique-constraint failure Prisma raises on (organizationId, name). */
class DuplicateTagError extends Error {
  readonly code = "P2002";
}

/**
 * The tag table, in memory: enough of `promptTag` for the repository, plus the
 * two tables its delete-by-name transaction sweeps.
 */
function inMemoryTagDatabase() {
  const rows: PromptTag[] = [];
  let clock = 0;

  const matches = (row: PromptTag, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key as keyof PromptTag] === value);

  const promptTag = {
    create: ({ data }: { data: Record<string, unknown> }) => {
      if (
        rows.some((row) => row.organizationId === data.organizationId && row.name === data.name)
      ) {
        return Promise.reject(new DuplicateTagError("Unique constraint failed"));
      }
      const row = {
        ...data,
        createdAt: new Date(++clock),
        updatedAt: new Date(clock),
        updatedById: null,
      } as unknown as PromptTag;
      rows.push(row);
      return Promise.resolve(row);
    },
    createMany: ({
      data,
      skipDuplicates,
    }: {
      data: Record<string, unknown>[];
      skipDuplicates?: boolean;
    }) => {
      for (const entry of data) {
        const clash = rows.some(
          (row) => row.organizationId === entry.organizationId && row.name === entry.name,
        );
        if (clash && skipDuplicates) continue;
        if (clash) return Promise.reject(new DuplicateTagError("Unique constraint failed"));
        rows.push({
          ...entry,
          createdAt: new Date(++clock),
          updatedAt: new Date(clock),
          updatedById: null,
        } as unknown as PromptTag);
      }
      return Promise.resolve({ count: data.length });
    },
    findMany: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        rows
          .filter((row) => matches(row, where))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      ),
    findFirst: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.find((row) => matches(row, where)) ?? null),
    delete: ({ where }: { where: Record<string, unknown> }) => {
      const at = rows.findIndex((row) => matches(row, where));
      return Promise.resolve(at === -1 ? null : rows.splice(at, 1)[0]);
    },
    deleteMany: ({ where }: { where: Record<string, unknown> }) => {
      const kept = rows.filter((row) => !matches(row, where));
      const count = rows.length - kept.length;
      rows.splice(0, rows.length, ...kept);
      return Promise.resolve({ count });
    },
  };

  const client = {
    promptTag,
    project: { findMany: () => Promise.resolve([]) },
    promptTagAssignment: { deleteMany: () => Promise.resolve({ count: 0 }) },
    $transaction: (run: (tx: unknown) => Promise<unknown>) => run(client),
  };

  return client as unknown as PromptTagDatabase;
}

/** Hono's own refusal wins; anything else degrades to the generic unknown. */
const boundaryErrorHandler: ErrorHandler = (error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  return c.json({ error: "Internal Server Error" }, 500);
};

function testSecurity(): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => next();
  const asProject: MiddlewareHandler = async (c, next) => {
    c.set("project", { id: "project_tags", slug: "project-tags" });
    await next();
  };
  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: boundaryErrorHandler,
    canonicalErrorHandler: boundaryErrorHandler,
    authenticateProject: () => asProject,
    authorizeProjectPermission: () => pass,
    authorizeApiKeyCeiling: () => pass,
    authenticateOrganization: () => pass,
    authorizeOrganizationPermission: () => pass,
    authorizeRouteTeamPermission: () => pass,
    authorizeRouteProjectPermission: () => pass,
    authenticateOrganizationThrowing: pass,
    authorizeOrganizationPermissionThrowing: () => pass,
  };
  return createAppRestSecurity(ports);
}

function buildApi() {
  const repository = PrismaPromptTagRepository.create({ prisma: inMemoryTagDatabase() });
  const tags = PromptTagService.create(repository);

  // The three tag operations the routes reach, delegated exactly as
  // `PromptService` delegates them. Cast once, here at the seam.
  const service = {
    listTags: (input: { organizationId: string }) => tags.getAll(input),
    createTag: (input: { organizationId: string; name: string }) => tags.create(input),
    tryDeleteTagByName: (input: { organizationId: string; name: string }) =>
      tags.tryDeleteByName(input),
  } as unknown as PromptRestService;

  const ports: PromptRestPorts = {
    organizationMiddleware: async (c, next) => {
      c.set("organization", { id: ORGANIZATION_ID });
      await next();
    },
    platformUrl: (() => "https://app.test") as unknown as PlatformUrlBuilder,
    afterPromptCreated: () => undefined,
    uniqueConstraintTargets: () => [],
  };

  const app = createPromptsRestApp({ security: testSecurity(), prompts: () => service, ports });

  return {
    repository,
    listTagNames: async (): Promise<string[]> => {
      const response = await app.hono.request("/api/prompts/tags");
      const body = (await response.json()) as { name: string }[];
      return body.map((tag) => tag.name);
    },
    createTag: (name: string) =>
      app.hono.request("/api/prompts/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    deleteTag: (name: string) =>
      app.hono.request(`/api/prompts/tags/${name}`, { method: "DELETE" }),
  };
}

describe("the prompt tag routes", () => {
  let api: ReturnType<typeof buildApi>;

  beforeEach(async () => {
    api = buildApi();
    await api.repository.seedForOrg({ organizationId: ORGANIZATION_ID });
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
