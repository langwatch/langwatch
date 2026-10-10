/**
 * What a REST handler is handed and what the framework does with its answer.
 * Spec: specs/server/feature-application-and-transports.feature.
 */

import { moduleApi } from "@langwatch/module";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { createErrorHandler } from "../../errors.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

interface NoteApi {
  createNote(input: { projectId: string; pages: number }): Promise<{ id: string; pages: number }>;
}

const NoteApi = moduleApi<NoteApi>()("annotation");
const VERSION = "2026-09-08";
const PROJECT_ID = "project-1";

const notes = defineRestRouter(NoteApi)
  .withNamespace("notes")
  .withVersion(VERSION)
  .post("/", "createNote")
  .withInput(z.object({ projectId: z.string(), pages: z.coerce.number().int() }))
  .withPermission("annotations:update")
  .withOutput(z.object({ id: z.string(), pages: z.number() }))
  .withoutAudit("test route")
  .handle(({ app, input }) => app.createNote(input))
  .build();

function mountNotes() {
  const createNote = vi.fn(async (input: { projectId: string; pages: number }) => ({
    id: `note-in-${input.projectId}`,
    pages: input.pages,
  }));

  const authorize = vi.fn(() => ({ permitted: true, organizationRole: null }));
  const identity = {
    authenticate: () => ({
      actor: { type: "api_key", id: "key-1" } as const,
      scope: { tier: "project", id: PROJECT_ID } as const,
    }),
    identify: () => ({ actor: null, scope: { tier: "project", id: PROJECT_ID } as const }),
    authorize,
  };

  const app = createRestRuntime({
    authorization: authorizationPort,
    identity,
  }).mount(notes.router(), {
    app: () => ({ createNote }),
    onError: createErrorHandler(),
  });

  return { app, createNote };
}

function post(app: ReturnType<typeof mountNotes>["app"], body: unknown) {
  return app.request(`/api/notes/${VERSION}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("given an endpoint with a declared input schema", () => {
  /** @scenario "A handler receives validated input and returns a value" */
  it("hands the handler the parsed input and renders the value it returned", async () => {
    const { app, createNote } = mountNotes();

    const response = await post(app, { projectId: PROJECT_ID, pages: "3" });

    expect(createNote).toHaveBeenCalledWith({ projectId: PROJECT_ID, pages: 3 });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: `note-in-${PROJECT_ID}`, pages: 3 });
  });

  it("refuses input the schema rejects before the handler runs", async () => {
    const { app, createNote } = mountNotes();

    const response = await post(app, { projectId: PROJECT_ID, pages: "not-a-number" });

    expect(response.status).toBe(422);
    expect(createNote).not.toHaveBeenCalled();
  });
});

describe("given a handler that returns a plain value", () => {
  /** @scenario "The transport owns the response" */
  it("renders it as a JSON 200 though the handler named no status, envelope or content type", async () => {
    const { app } = mountNotes();

    const response = await post(app, { projectId: PROJECT_ID, pages: 1 });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ id: `note-in-${PROJECT_ID}`, pages: 1 });
  });
});

describe("given a request naming a project the credential does not cover", () => {
  /** @scenario "A caller may not reach a scope their credential does not cover" */
  it("refuses it as scope_input_mismatch and never discloses either project", async () => {
    const { app, createNote } = mountNotes();

    const existing = await post(app, { projectId: "project-2", pages: 1 });
    const unknown = await post(app, { projectId: "project-that-never-existed", pages: 1 });

    expect(existing.status).toBe(403);
    expect(unknown.status).toBe(403);
    expect(createNote).not.toHaveBeenCalled();

    const existingBody = (await existing.json()) as { code: string };
    const unknownBody = (await unknown.json()) as { code: string };

    expect(existingBody.code).toBe("scope_input_mismatch");
    expect(unknownBody.code).toBe(existingBody.code);
    expect(JSON.stringify(existingBody)).not.toContain("project-2");
    expect(JSON.stringify(existingBody)).not.toContain(PROJECT_ID);
    expect(JSON.stringify(unknownBody)).not.toContain("never-existed");
  });
});
