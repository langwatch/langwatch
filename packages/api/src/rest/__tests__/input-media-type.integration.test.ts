/**
 * A JSON body that names its media type is refused under any other Content-Type before the parser
 * reads it, as a raw body is (Alex, G3b). Spec: packages/api/specs/transport-conventions.feature.
 */

import { moduleApi } from "@langwatch/module";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createApiDouble, authorizationPort } from "../../__tests__/api-double.ts";
import { createErrorHandler } from "../../errors.ts";
import type { RestCaller } from "../../hosting/api-door.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

const VERSION = "2026-09-08";
const JSON_TYPE = "application/json";
const CALLER: RestCaller = {
  actor: { type: "api_key", id: "key-1" },
  scope: { tier: "organization", id: "organization-1" },
};

interface NoteApi {
  record(input: { text: string }): Promise<{ text: string }>;
}

const NoteApi = moduleApi<NoteApi>()("annotation");

const note = z.object({ text: z.string() });

function notesRouter() {
  return defineRestRouter(NoteApi)
    .withNamespace("notes")
    .withVersion(VERSION)
    .withAddressing("v1-only")
    .withCredential("organization");
}

const notes = notesRouter()
  .post("/", "recordNote")
  .withInput(note, { mediaType: JSON_TYPE })
  .withPermission("organization:manage")
  .withOutput(note)
  .withoutAudit("test route")
  .handle(async ({ app, input }) => app.record({ text: input.text }))

  .post("/legacy", "recordLegacyNote")
  .withInput(note, { mediaType: JSON_TYPE, mismatch: "malformed_request" })
  .withPermission("organization:manage")
  .withOutput(note)
  .withoutAudit("test route")
  .handle(async ({ app, input }) => app.record({ text: input.text }))
  .build();

function notesApp() {
  const record = vi.fn(async ({ text }: { text: string }) => ({ text }));
  const api = createApiDouble<NoteApi>({ record });
  const runtime = createRestRuntime({
    authorization: authorizationPort,
    identity: {
      authenticate: () => CALLER,
      authorize: () => ({ permitted: true, organizationRole: null }),
    },
  });
  const hono = runtime.mount(notes.router(), { app: () => api, onError: createErrorHandler() });

  return { hono, record };
}

function post(contentType: string | undefined): RequestInit {
  return {
    method: "POST",
    headers: contentType === undefined ? {} : { "Content-Type": contentType },
    body: JSON.stringify({ text: "hello" }),
  };
}

describe("a JSON body route that names the media type it reads", () => {
  describe.each([
    { case: "under text/plain", contentType: "text/plain" },
    { case: "under a JSON look-alike", contentType: "application/json-seq" },
    { case: "with no Content-Type at all", contentType: undefined },
  ])("when the body is sent $case", ({ contentType }) => {
    /** @scenario "A JSON body sent under another media type than its route names is refused before it is parsed" */
    it("refuses it with 415 unsupported_media_type and never reaches the handler", async () => {
      const { hono, record } = notesApp();

      const response = await hono.request("/api/v1/notes", post(contentType));

      expect(response.status).toBe(415);
      await expect(response.json()).resolves.toMatchObject({ code: "unsupported_media_type" });
      expect(record).not.toHaveBeenCalled();
    });
  });

  describe.each([
    { case: "with a charset parameter", contentType: "application/json; charset=utf-8" },
    { case: "in another letter case", contentType: "Application/JSON" },
  ])("when the body is sent under the named type $case", ({ contentType }) => {
    /** @scenario "A JSON body sent under another media type than its route names is refused before it is parsed" */
    it("parses it and hands the handler the input", async () => {
      const { hono, record } = notesApp();

      const response = await hono.request("/api/v1/notes", post(contentType));

      expect(response.status).toBe(200);
      expect(record).toHaveBeenCalledWith({ text: "hello" });
    });
  });
});

describe("a JSON body route that keeps main's 400 for another media type", () => {
  describe("when the body is sent under text/plain", () => {
    /** @scenario "A JSON body route that keeps main's 400 declares it, and names only a JSON media type" */
    it("refuses it with 400 malformed_request and never reaches the handler", async () => {
      const { hono, record } = notesApp();

      const response = await hono.request("/api/v1/notes/legacy", post("text/plain"));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "malformed_request" });
      expect(record).not.toHaveBeenCalled();
    });
  });

  describe("when a route names a media type the JSON parser cannot read", () => {
    /** @scenario "A JSON body route that keeps main's 400 declares it, and names only a JSON media type" */
    it("refuses to build", () => {
      expect(() =>
        notesRouter().post("/", "recordNote").withInput(note, { mediaType: "text/plain" }),
      ).toThrow(/is not JSON/);
    });
  });
});
