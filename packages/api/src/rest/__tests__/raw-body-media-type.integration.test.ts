/**
 * A raw body is read only under the media type its route declared (Alex, 2026-10-05, E9): any
 * other Content-Type is refused after the door and before the handler, with 415 or the 400 a
 * route keeping main's wire declares. Spec: packages/api/specs/transport-conventions.feature.
 */

import { createHmac } from "node:crypto";

import { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createApiDouble } from "../../__tests__/api-double.ts";
import { anyAuthenticated } from "../../access/access.ts";
import {
  createErrorHandler,
  ProjectInvalidCredentialsError,
  ProjectMissingCredentialsError,
} from "../../errors.ts";
import type { RestCaller } from "../../hosting/api-door.ts";
import { defineRestRouter } from "../declaration.ts";
import type { RestProtocolRefusal } from "../response-kind.ts";
import { createRestRuntime } from "../runtime.ts";

const VERSION = "2026-09-08";
const KEY = "Bearer the-key";
const SECRET = "the-shared-secret";
const JSON_TYPE = "application/json";
const MAIN_NOT_JSON_BODY = JSON.stringify({ message: "Invalid body, expecting json" });
const ORGANIZATION = { tier: "organization", id: "organization-1" } as const;
const PROTOCOL_REASON = "the legacy family's wire is pinned to main's sentences";

interface NoteApi {
  record(input: { raw: string }): Promise<{ raw: string }>;
}

const NoteApi = moduleApi<NoteApi>()("annotation");

const answer = z.object({ raw: z.string() });

/** Main's sentence for a body it would not read, and the canonical status for anything else. */
const legacyRefusal: RestProtocolRefusal = ({ failure, response }) => {
  const handled = HandledError.isHandled(failure) ? failure : undefined;

  return response.write({
    status: handled?.httpStatus ?? 500,
    mediaType: JSON_TYPE,
    body: handled?.code === "malformed_request" ? MAIN_NOT_JSON_BODY : "{}",
  });
};

const notes = defineRestRouter(NoteApi)
  .withNamespace("notes")
  .withVersion(VERSION)
  .withAddressing("v1-only")
  .withCredential("organization")

  .post("/", "recordNote")
  .withRawBody("text", { mediaType: JSON_TYPE })
  .withPermission("organization:manage")
  .withOutput(answer)
  .handle(async ({ app, raw }) => app.record({ raw }))

  .post("/legacy", "recordLegacyNote")
  .withRawBody("text", { mediaType: JSON_TYPE, mismatch: "malformed_request" })
  .withPermission("organization:manage")
  .withOutput(answer)
  .handle(async ({ app, raw }) => app.record({ raw }))

  .post("/protocol", "recordProtocolNote")
  .withRawBody("text", { mediaType: JSON_TYPE, mismatch: "malformed_request" })
  .withPermission("organization:manage")
  .withResponse("protocol", {
    produces: JSON_TYPE,
    because: PROTOCOL_REASON,
    refusal: legacyRefusal,
  })
  .handle(async ({ app, raw, response }) =>
    response.write({
      status: 200,
      mediaType: JSON_TYPE,
      body: JSON.stringify(await app.record({ raw })),
    }),
  )

  .post("/signed", "recordSignedNote")
  .withRawBody("text", { mediaType: JSON_TYPE })
  .withAccess(anyAuthenticated({ reason: "the body's signature is the whole gate" }))
  .withOutput(answer)
  .handle(async ({ app, raw }) => app.record({ raw }))

  .post("/unchecked", "recordUncheckedNote")
  .withRawBody("text")
  .withPermission("organization:manage")
  .withOutput(answer)
  .handle(async ({ app, raw }) => app.record({ raw }))
  .build();

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

function notesApp() {
  const record = vi.fn(async ({ raw }: { raw: string }) => ({ raw }));
  const api = createApiDouble<NoteApi>({ record });

  const identify = vi.fn(({ request, rawBody }: { request: Request; rawBody?: unknown }) => {
    if (typeof rawBody !== "string" || request.headers.get("X-Signature") !== sign(rawBody)) {
      throw new ProjectInvalidCredentialsError();
    }

    return { actor: null, scope: ORGANIZATION };
  });

  const runtime = createRestRuntime({
    identity: {
      authenticate: ({ request }) => keyDoor(request),
      identify,
      authorize: () => ({ permitted: true, organizationRole: null }),
    },
  });

  const hono = runtime.mount(notes.router(), { app: () => api, onError: createErrorHandler() });

  return { hono, record };
}

function post({
  body,
  contentType,
  headers = { Authorization: KEY },
}: {
  body: string;
  contentType?: string;
  headers?: Record<string, string>;
}): RequestInit {
  return {
    method: "POST",
    headers: { ...(contentType === undefined ? {} : { "Content-Type": contentType }), ...headers },
    body,
  };
}

describe("a raw-body route that declares the media type it reads", () => {
  describe.each([
    { case: "under text/plain", contentType: "text/plain" },
    { case: "under a JSON look-alike", contentType: "application/json-seq" },
    { case: "with no Content-Type at all", contentType: undefined },
  ])("when the body is sent $case", ({ contentType }) => {
    /** @scenario "A raw body sent under another media type is refused with 415 before the handler" */
    it("refuses it with 415 unsupported_media_type and never reaches the handler", async () => {
      const { hono, record } = notesApp();

      const response = await hono.request("/api/v1/notes", post({ body: "{}", contentType }));

      expect(response.status).toBe(415);
      await expect(response.json()).resolves.toMatchObject({ code: "unsupported_media_type" });
      expect(record).not.toHaveBeenCalled();
    });
  });

  describe.each([
    { case: "exactly", contentType: "application/json" },
    { case: "with a charset parameter", contentType: "application/json; charset=utf-8" },
    { case: "in another letter case", contentType: "Application/JSON" },
  ])("when the body is sent under the declared type $case", ({ contentType }) => {
    /** @scenario "A raw body sent under another media type is refused with 415 before the handler" */
    it("hands the handler the body exactly as sent", async () => {
      const { hono, record } = notesApp();
      const body = '{ "spaced" :  true }';

      const response = await hono.request("/api/v1/notes", post({ body, contentType }));

      expect(response.status).toBe(200);
      expect(record).toHaveBeenCalledWith({ raw: body });
    });
  });
});

describe("a raw-body route that keeps main's 400 for another media type", () => {
  describe("when the body is sent under text/plain", () => {
    /** @scenario "A route that keeps main's 400 declares it, and its protocol renders it" */
    it("refuses it with 400 malformed_request and never reaches the handler", async () => {
      const { hono, record } = notesApp();

      const response = await hono.request(
        "/api/v1/notes/legacy",
        post({ body: "{}", contentType: "text/plain" }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "malformed_request" });
      expect(record).not.toHaveBeenCalled();
    });

    /** @scenario "A route that keeps main's 400 declares it, and its protocol renders it" */
    it("renders the 400 in the protocol's own document where the route declares one", async () => {
      const { hono, record } = notesApp();

      const response = await hono.request(
        "/api/v1/notes/protocol",
        post({ body: "{}", contentType: "text/plain" }),
      );

      expect(response.status).toBe(400);
      await expect(response.text()).resolves.toBe(MAIN_NOT_JSON_BODY);
      expect(record).not.toHaveBeenCalled();
    });
  });
});

describe("a raw-body route behind a credential door", () => {
  describe.each([
    { route: "/api/v1/notes", declares: "415" },
    { route: "/api/v1/notes/legacy", declares: "main's 400" },
  ])("when a caller presents no credential to the route declaring $declares", ({ route }) => {
    /** @scenario "A refused credential is answered before the media type is checked" */
    it("answers 401 before the media type is asked", async () => {
      const { hono, record } = notesApp();

      const response = await hono.request(
        route,
        post({ body: "{}", contentType: "text/plain", headers: {} }),
      );

      expect(response.status).toBe(401);
      expect(record).not.toHaveBeenCalled();
    });
  });

  describe("when a signed door's signature does not match a body under another type", () => {
    /** @scenario "A refused credential is answered before the media type is checked" */
    it("answers 401, never 415", async () => {
      const { hono, record } = notesApp();

      const response = await hono.request(
        "/api/v1/notes/signed",
        post({ body: "{}", contentType: "text/plain", headers: { "X-Signature": "forged" } }),
      );

      expect(response.status).toBe(401);
      expect(record).not.toHaveBeenCalled();
    });
  });
});

describe("a raw-body route that names no media type of its own", () => {
  describe.each(["text/plain", "application/x-protobuf", undefined])(
    "when the body is sent under %s",
    (contentType) => {
      /** @scenario "A raw body route that names no media type of its own is not checked" */
      it("hands the handler the body as sent", async () => {
        const { hono, record } = notesApp();

        const response = await hono.request(
          "/api/v1/notes/unchecked",
          post({ body: "as sent", contentType }),
        );

        expect(response.status).toBe(200);
        expect(record).toHaveBeenCalledWith({ raw: "as sent" });
      });
    },
  );

  describe("when a route declares a refusal for a media type it never named", () => {
    /** @scenario "A raw body route that names no media type of its own is not checked" */
    it("refuses to build", () => {
      expect(() =>
        defineRestRouter(NoteApi)
          .withNamespace("notes")
          .withVersion(VERSION)
          .post("/", "recordNote")
          .withRawBody("text", { mismatch: "malformed_request" }),
      ).toThrow(/names none it reads/);
    });
  });

  describe.each(["application/json; charset=utf-8", "*/*", "application/*", "json"])(
    "when a route names %j as the media type it reads",
    (mediaType) => {
      /** @scenario "A raw body route that names no media type of its own is not checked" */
      it("refuses to build", () => {
        expect(() =>
          defineRestRouter(NoteApi)
            .withNamespace("notes")
            .withVersion(VERSION)
            .post("/", "recordNote")
            .withRawBody("text", { mediaType }),
        ).toThrow(/names no single media type/);
      });
    },
  );
});
