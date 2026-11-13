/**
 * A permission asked only when the parsed input carries a field, at the scope the route's own
 * permission was asked at. Spec: packages/api/specs/permission-targets.feature
 */
import { moduleApi } from "@langwatch/module";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { createErrorHandler } from "../../errors.ts";
import type { RestIdentity } from "../../hosting/api-door.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

type NotesApi = { update(input: { id: string; tags?: string[] }): Promise<{ id: string }> };

const NotesApi = moduleApi<NotesApi>()("prompt");

function notesRouter() {
  return defineRestRouter(NotesApi)
    .withNamespace("notes")
    .withVersion("2026-11-13")
    .withCredential("project")
    .put("/:id", "updateNote")
    .keepsRecords()
    .withAudit("notes.update")
    .withParams(z.object({ id: z.string() }))
    .withInput(z.object({ text: z.string(), tags: z.array(z.string()).optional() }))
    .withPermission("prompts:update")
    .withPermissionWhenPresent({ field: "tags", permission: "prompts:manage" })
    .withOutput(z.object({ id: z.string() }))
    .handle(({ app, input }) => app.update({ id: input.id, tags: input.tags }));
}

function mount() {
  const authorize = vi.fn<NonNullable<RestIdentity["authorize"]>>(({ permission }) => ({
    permitted: permission !== "prompts:manage",
    organizationRole: null,
  }));
  const door: RestIdentity = {
    authenticate: () => ({
      actor: { type: "api_key", id: "api_key_1" },
      scope: { tier: "project", id: "project_1" },
    }),
    authorize,
  };
  const update = vi.fn<NotesApi["update"]>(async ({ id }) => ({ id }));
  const hono = createRestRuntime({
    identity: door,
    authorization: authorizationPort,
    audit: { record: () => {} },
  }).mount(notesRouter().build().router(), {
    app: () => ({ update }),
    credential: "project",
    onError: createErrorHandler(),
  });
  const send = (body: Record<string, unknown>) =>
    hono.fetch(
      new Request("http://api.test/api/notes/2026-11-13/note_1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  return { send, update, authorize };
}

describe("withPermissionWhenPresent", () => {
  describe("given a caller holding the route's permission but not the field's", () => {
    /** @scenario A route asks the field's permission only when the body carries the field */
    it("runs the handler for a body without the field, asking nothing more", async () => {
      const { send, update, authorize } = mount();

      const response = await send({ text: "hi" });

      expect(response.status).toBe(200);
      expect(update).toHaveBeenCalledOnce();
      expect(authorize).not.toHaveBeenCalled();
    });

    /** @scenario A route asks the field's permission only when the body carries the field */
    it("refuses a body carrying the field before the handler", async () => {
      const { send, update, authorize } = mount();

      const response = await send({ text: "hi", tags: ["production"] });
      const body = (await response.json()) as { code: string };

      expect(response.status).toBe(403);
      expect(body.code).toBe("permission_denied");
      expect(update).not.toHaveBeenCalled();
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          permission: "prompts:manage",
          target: { tier: "project", id: "project_1" },
        }),
      );
    });
  });

  describe("when the field is not in the route's input", () => {
    /** @scenario A field permission names a field the route's input parses */
    it("refuses the declaration", () => {
      expect(() =>
        defineRestRouter(NotesApi)
          .withNamespace("notes")
          .withVersion("2026-11-13")
          .put("/:id", "updateNote")
          .withInput(z.object({ text: z.string() }))
          .withPermission("prompts:update")
          // @ts-expect-error "tags" is not a field of the input
          .withPermissionWhenPresent({ field: "tags", permission: "prompts:manage" }),
      ).toThrow("a field its input does not parse");
    });
  });
});
