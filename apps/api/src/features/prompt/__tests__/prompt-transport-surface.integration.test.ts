/**
 * The prompt transports the browser and the API clients already call: the
 * `prompts.*` and `promptTags.*` procedure names, and the `/api/prompts` base
 * path the REST family is published at. Both are mounted over the
 * process-owned Prompt service rather than building one per request.
 * @see modules/prompt/specs/prompt.feature
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import type { AppTrpcPolicyMiddlewares } from "@langwatch/api/trpc";
import { declareAuthzMiddleware, type AuthzDeclaration } from "@langwatch/authz-contract";
import { createPromptsRestApp, type PromptTrpcContext } from "@langwatch/prompt-server";
import { initTRPC } from "@trpc/server";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createPromptTagTrpcRouter, createPromptTrpcRouter } from "../prompt-trpc.mount.ts";

/** The names the browser calls; a rename here breaks every caller of them. */
const PROMPT_PROCEDURES = [
  "getAllPromptsForProject",
  "getCopies",
  "restoreVersion",
  "create",
  "update",
  "updateHandle",
  "getByIdOrHandle",
  "checkHandleUniqueness",
  "checkModifyPermission",
  "getAllVersionsForPrompt",
  "delete",
  "copy",
  "duplicate",
  "syncFromSource",
  "pushToCopies",
  "getTagsForConfig",
  "assignTag",
];

const PROMPT_TAG_PROCEDURES = ["getAll", "create", "rename", "delete"];

function passThroughMiddlewares(): AppTrpcPolicyMiddlewares {
  const passThrough = ({ next }: { next: () => Promise<unknown> }) => next();
  return {
    tracer: passThrough,
    logger: passThrough,
    handledError: passThrough,
    scopeLineageGuard: () => passThrough,
    declaredCheck: (declaration: AuthzDeclaration) =>
      declareAuthzMiddleware(
        declaration,
        passThrough as unknown as (params: never) => Promise<unknown>,
      ),
    enforceCheck: passThrough,
    auditMutations: passThrough,
  };
}

function procedureNames(router: unknown): string[] {
  return Object.keys((router as { _def: { procedures: Record<string, unknown> } })._def.procedures);
}

const renderError: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

function projectSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const asProject: MiddlewareHandler = async (c, next) => {
    c.set("project", { id: "project_1", slug: "acme" });
    await next();
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderError,
    canonicalErrorHandler: renderError,
    authenticateProject: () => asProject,
    authorizeProjectPermission: () => noop,
    authorizeApiKeyCeiling: () => noop,
    authenticateOrganization: () => noop,
    authorizeOrganizationPermission: () => noop,
    authorizeRouteTeamPermission: () => noop,
    authorizeRouteProjectPermission: () => noop,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: () => noop,
  } as never);
}

describe("given the prompt transports mounted on the process's own roots", () => {
  describe("when a caller uses tRPC", () => {
    /** @scenario existing transports preserve their public surface */
    it("answers to the procedure names its callers already use", () => {
      const trpc = initTRPC.context<PromptTrpcContext>().create();
      const mount = {
        root: trpc,
        protectedProcedure: trpc.procedure,
        middlewares: passThroughMiddlewares(),
      };

      const prompts = createPromptTrpcRouter({
        ...mount,
        ports: { onPromptCreated: vi.fn(async () => {}) },
      } as never);
      const promptTags = createPromptTagTrpcRouter(mount as never);

      expect(procedureNames(prompts).sort()).toEqual([...PROMPT_PROCEDURES].sort());
      expect(procedureNames(promptTags).sort()).toEqual([...PROMPT_TAG_PROCEDURES].sort());
    });
  });

  describe("when a caller uses the REST prompt API", () => {
    /** @scenario existing transports preserve their public surface */
    it("publishes the same /api/prompts paths, built without constructing a service", () => {
      const prompts = vi.fn(() => {
        throw new Error("mounting must not construct the prompt service");
      });
      const app = createPromptsRestApp({
        security: projectSecurity(),
        prompts: prompts as never,
        tagCatalog: () => {
          throw new Error("mounting must not construct the prompt application");
        },
        ports: {
          organizationMiddleware: (async (_c, next) => {
            await next();
          }) as MiddlewareHandler,
        } as never,
      });

      const paths = [...new Set(app.routes.map((route) => route.path))];

      // The family is twinned onto /api/v1 by the door; the /api addresses its
      // callers already hold are what must not move.
      expect(paths).toEqual(
        expect.arrayContaining([
          "/api/prompts",
          "/api/prompts/:id{.+}",
          "/api/prompts/:id{.+?}/versions",
          "/api/prompts/:id{.+?}/versions/:versionId/restore",
          "/api/prompts/:id{.+?}/tags/:tag",
          "/api/prompts/tags",
          "/api/prompts/tags/:tag",
          "/api/prompts/:id{.+?}/sync",
        ]),
      );
      expect(prompts).not.toHaveBeenCalled();
    });
  });
});
