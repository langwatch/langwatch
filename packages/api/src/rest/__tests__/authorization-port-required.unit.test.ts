/**
 * Authorization fails closed (ARCHITECTURE.md §8): a REST family is never mounted without the
 * port every route is authorized through. Spec: packages/api/specs/api-door.feature.
 */
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createErrorHandler } from "../../errors.ts";
import type { RestIdentity } from "../../hosting/api-door.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

type ProjectsApi = { read(input: { projectId: string }): Promise<{ id: string }> };

const ProjectsApi = moduleApi<ProjectsApi>()("project");
const caller = { actor: { type: "user", id: "user_sam" }, scope: null } as const;
const door: RestIdentity = { authenticate: () => caller };

const routes = defineRestRouter(ProjectsApi)
  .withNamespace("projects")
  .withVersion("2026-10-09")
  .withCredential("organization")
  .get("/:projectId", "getProject")
  .withParams(z.object({ projectId: z.string() }))
  .withPermission("project:view")
  .withOutput(z.object({ id: z.string() }))
  .handle(({ app, input }) => app.read({ projectId: input.projectId }))
  .build()
  .router();

describe("a REST family", () => {
  describe("when it is mounted without an authorization port", () => {
    /** @scenario "A REST family mounted without an authorization port is refused" */
    it("refuses the mount, naming the family", () => {
      const runtime = createRestRuntime(
        // @ts-expect-error the type requires the port; the mount refuses an untyped caller too
        { identity: door },
      );

      expect(() =>
        runtime.mount(routes, {
          app: () => ({ read: async ({ projectId }) => ({ id: projectId }) }),
          onError: createErrorHandler(),
        }),
      ).toThrow("REST projects is mounted with no authorization port");
    });
  });
});
