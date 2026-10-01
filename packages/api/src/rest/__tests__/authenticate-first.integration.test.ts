/**
 * A REST request is authenticated before its body is parsed or validated (ARCHITECTURE.md §8,
 * Alex, 2026-09-30): a refused credential answers 401, never the 422 its body would have earned.
 * Spec: packages/api/specs/transport-conventions.feature.
 */

import { createHmac } from "node:crypto";

import { moduleApi } from "@langwatch/module";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createApiDouble } from "../../__tests__/api-double.ts";
import { anyAuthenticated, type Authorize } from "../../access/access.ts";
import {
  createErrorHandler,
  PayloadTooLargeError,
  ProjectInvalidCredentialsError,
  ProjectMissingCredentialsError,
} from "../../errors.ts";
import { BrowserSessionIdentity } from "../browser-session.ts";
import { SessionReader } from "../credential.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime, type RestCaller } from "../runtime.ts";

const VERSION = "2026-09-08";
const KEY = "Bearer the-key";
const SECRET = "the-shared-secret";
const PROJECT_ID = "project-7";
const BODY_CAP_BYTES = 64;
const ORGANIZATION = { tier: "organization", id: "organization-1" } as const;

interface NoteApi {
  create(input: { title: string }): Promise<{ id: string }>;
  attach(input: { projectId: string; name: string }): Promise<{ id: string }>;
  record(input: { id: string; raw: string }): Promise<{ id: string; raw: string }>;
}

const NoteApi = moduleApi<NoteApi>()("annotation");

/** The application, and a spy per operation so a test can say the handler was never reached. */
function application() {
  const calls = {
    create: vi.fn(async ({ title }: { title: string }) => ({ id: title })),
    attach: vi.fn(async ({ projectId, name }: { projectId: string; name: string }) => ({
      id: `${projectId}:${name}`,
    })),
    record: vi.fn(async ({ id, raw }: { id: string; raw: string }) => ({ id, raw })),
  };

  return { api: createApiDouble<NoteApi>(calls), calls };
}

/** A key door: nothing presented is missing, anything but the key is invalid. */
function keyDoor(request: Request): RestCaller {
  const presented = request.headers.get("Authorization");

  if (!presented) throw new ProjectMissingCredentialsError();
  if (presented !== KEY) throw new ProjectInvalidCredentialsError();

  return { actor: { type: "api_key", id: "key-1" }, scope: ORGANIZATION };
}

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

const notes = defineRestRouter(NoteApi)
  .withNamespace("notes")
  .withVersion(VERSION)
  .withAddressing("v1-only")
  .withCredential("organization")

  .post("/", "createNote")
  .withInput(z.object({ title: z.string().min(1) }))
  .withPermission("organization:manage")
  .withBodyLimit({ maxBytes: BODY_CAP_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withOutput(z.object({ id: z.string() }))
  .handle(async ({ app, input }) => app.create({ title: input.title }))

  .post("/attachments", "attachNote")
  .withQuery(z.object({ projectId: z.string() }))
  .withMultipart({ fields: z.object({ name: z.string() }), files: { file: { required: true } } })
  .withPermission("project:view", { at: "route", param: "projectId" })
  .withOutput(z.object({ id: z.string() }))
  .handle(async ({ app, input }) => app.attach({ projectId: input.projectId, name: input.name }))

  .post("/signed/:id", "recordSignedNote")
  .withParams(z.object({ id: z.string().min(4) }))
  .withRawBody("text", { mediaType: "application/json" })
  .withAccess(anyAuthenticated({ reason: "the body's signature is the whole gate" }))
  .withOutput(z.object({ id: z.string(), raw: z.string() }))
  .handle(async ({ app, input, raw }) => app.record({ id: input.id, raw }))
  .build();

function notesApp() {
  const { api, calls } = application();
  const authenticate = vi.fn(({ request }: { request: Request }) => keyDoor(request));
  const authorize = vi.fn(() => ({ permitted: true, organizationRole: null }));

  const identify = vi.fn(({ request, rawBody }: { request: Request; rawBody?: unknown }) => {
    const signature = request.headers.get("X-Signature");

    if (typeof rawBody !== "string" || signature !== sign(rawBody)) {
      throw new ProjectInvalidCredentialsError();
    }

    return { actor: null, scope: ORGANIZATION };
  });

  const runtime = createRestRuntime({ identity: { authenticate, identify, authorize } });

  const hono = runtime.mount(notes.router(), { app: () => api, onError: createErrorHandler() });

  return { hono, calls, authenticate, authorize, identify };
}

function postJson(body: string, headers: Record<string, string> = {}): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body };
}

function upload(): FormData {
  const body = new FormData();

  body.set("name", "report.csv");
  body.set("file", new File(["a,b\n1,2"], "report.csv", { type: "text/csv" }));

  return body;
}

describe("a request authenticated before its body is parsed", () => {
  describe("given a JSON route whose body fails its schema", () => {
    /** @scenario "A refused credential is answered before the body is validated" */
    it("answers 401 to a caller presenting no credential, not 422", async () => {
      const { hono, calls } = notesApp();

      const response = await hono.request("/api/v1/notes", postJson("{}"));

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ code: "missing_credentials" });
      expect(calls.create).not.toHaveBeenCalled();
    });

    /** @scenario "A refused credential is answered before the body is validated" */
    it("answers 401 to a caller presenting an invalid credential, even with malformed JSON", async () => {
      const response = await notesApp().hono.request(
        "/api/v1/notes",
        postJson("{not json", { Authorization: "Bearer another-key" }),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ code: "invalid_credentials" });
    });

    /** @scenario "A refused credential is answered before the body is validated" */
    it("answers 422 to an authenticated caller", async () => {
      const response = await notesApp().hono.request(
        "/api/v1/notes",
        postJson("{}", { Authorization: KEY }),
      );

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({ code: "validation_error" });
    });
  });

  describe("given a JSON body over the route's cap", () => {
    const oversized = JSON.stringify({ title: "x".repeat(BODY_CAP_BYTES) });

    /** @scenario "A refused credential is answered before the body is validated" */
    it("answers 401 to a caller presenting no credential, before the cap is measured", async () => {
      const response = await notesApp().hono.request("/api/v1/notes", postJson(oversized));

      expect(response.status).toBe(401);
    });

    /** @scenario "A refused credential is answered before the body is validated" */
    it("answers 413 to an authenticated caller", async () => {
      const response = await notesApp().hono.request(
        "/api/v1/notes",
        postJson(oversized, { Authorization: KEY }),
      );

      expect(response.status).toBe(413);
    });
  });

  describe("given a multipart upload whose project is named in its query", () => {
    /** @scenario "A refused credential is answered before the body is validated" */
    it("answers 401 to an upload presenting no key, before the form is read", async () => {
      const { hono, calls, authorize } = notesApp();

      const response = await hono.request(`/api/v1/notes/attachments?projectId=${PROJECT_ID}`, {
        method: "POST",
        body: upload(),
      });

      expect(response.status).toBe(401);
      expect(authorize).not.toHaveBeenCalled();
      expect(calls.attach).not.toHaveBeenCalled();
    });

    /** @scenario "The project a route acts on is still resolved from its parsed input" */
    it("resolves the project from the parsed query once the caller is authenticated", async () => {
      const { hono, authorize } = notesApp();

      const response = await hono.request(`/api/v1/notes/attachments?projectId=${PROJECT_ID}`, {
        method: "POST",
        headers: { Authorization: KEY },
        body: upload(),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ id: `${PROJECT_ID}:report.csv` });
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({ target: { tier: "project", id: PROJECT_ID } }),
      );
    });
  });

  describe("given a signed door that verifies the raw body", () => {
    const exact = '{ "a" :  1 }';

    /** @scenario "A signed door verifies the raw body before anything is parsed" */
    it("answers 401 to a bad signature before the path is validated", async () => {
      const { hono, calls } = notesApp();

      const response = await hono.request(
        "/api/v1/notes/signed/x",
        postJson(exact, { "X-Signature": sign("another body") }),
      );

      expect(response.status).toBe(401);
      expect(calls.record).not.toHaveBeenCalled();
    });

    /** @scenario "A signed door verifies the raw body before anything is parsed" */
    it("verifies the exact bytes sent and hands the handler those same bytes", async () => {
      const { hono, identify } = notesApp();

      const response = await hono.request(
        "/api/v1/notes/signed/note-1",
        postJson(exact, { "X-Signature": sign(exact) }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ id: "note-1", raw: exact });
      expect(identify).toHaveBeenCalledWith(expect.objectContaining({ rawBody: exact }));
    });
  });

  describe("given a browser-session write from another origin", () => {
    const drafts = defineRestRouter(NoteApi)
      .withNamespace("drafts")
      .withVersion(VERSION)
      .withAddressing("v1-only")
      .withCredential("browser")
      .post("/", "createDraft")
      .withInput(z.object({ title: z.string().min(1) }))
      .withAccess(anyAuthenticated({ reason: "a signed-in user may draft" }))
      .withOutput(z.object({ id: z.string() }))
      .handle(async ({ app, input }) => app.create({ title: input.title }))
      .build();

    function draftsApp() {
      const { api, calls } = application();

      const identity = BrowserSessionIdentity.create({
        sessions: SessionReader.create({
          verify: async (request) => (request.headers.has("cookie") ? { userId: "user-1" } : null),
        }),
        authz: createApiDouble<Authorize>(),
        publicBaseUrl: "https://app.example",
      });

      const hono = createRestRuntime({ identity }).mount(drafts.router(), {
        app: () => api,
        onError: createErrorHandler(),
      });

      return { hono, calls };
    }

    const foreign = { Origin: "https://other.example" };

    /** @scenario "A refused credential is answered before the body is validated" */
    it("answers 401 to a write carrying no session, not the origin refusal", async () => {
      const response = await draftsApp().hono.request("/api/v1/drafts", postJson("{}", foreign));

      expect(response.status).toBe(401);
    });

    /** @scenario "A write from a foreign origin is refused" */
    it("answers 403 to a signed-in session's write, before its body is validated", async () => {
      const { hono, calls } = draftsApp();

      const response = await hono.request(
        "/api/v1/drafts",
        postJson("{}", { ...foreign, Cookie: "session=1" }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: "cross_origin_refused" });
      expect(calls.create).not.toHaveBeenCalled();
    });
  });
});
