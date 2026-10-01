/**
 * @vitest-environment node
 * The session's way to an object's bytes: `storedObjects.getReadUrl` mints a
 * signed URL, and the signed content route serves it on any backend.
 * @see modules/stored-object/specs/stored-object-file-routes.feature
 */
import { Readable } from "node:stream";

import { createRestRuntime } from "@langwatch/api/rest";
import { createTrpcRuntime, type TrpcRuntimeMembers } from "@langwatch/api/trpc";
import type { PermissionDecision } from "@langwatch/authorization";
import { initTRPC } from "@trpc/server";
import type { ErrorHandler } from "hono";
import { describe, expect, it } from "vitest";

import {
  GrantedStoredObjectPermissions,
  MemoryStoredObjectFiles,
  createStoredObjectTestApp,
} from "../../app/__tests__/stored-object.fixture.ts";
import { storedObjectRest } from "../stored-object.rest.ts";
import { storedObjectTrpcTransport } from "../stored-object.trpc.ts";

const PROJECT = "project_1";
const OTHER_PROJECT = "project_2";
const OBJECT_ID = "so_media";
const BYTES = Buffer.from("trace audio");

type TestContext = { actor: { id: string } | null };

/** One trace-media object of PROJECT, and a viewer who holds traces:view there alone. */
function installed() {
  const files = new MemoryStoredObjectFiles();
  files.head = { status: "available", mediaType: "audio/mpeg", purpose: "trace_content" };
  files.read = {
    row: {
      id: OBJECT_ID,
      purpose: "trace_content",
      owner_kind: "trace",
      media_type: "audio/mpeg",
      size_bytes: BYTES.length,
    },
    stream: Readable.from([BYTES]),
  };
  const app = createStoredObjectTestApp({
    members: { files },
    permissions: new GrantedStoredObjectPermissions(["traces:view"]),
  });

  const trpc = initTRPC.context<TestContext>().create();
  const members: TrpcRuntimeMembers<TestContext> = {
    identity: {
      caller: (ctx) =>
        ctx.actor ? { actor: { type: "user", id: ctx.actor.id } } : { actor: null, scope: null },
    },
    authorization: {
      forRequest: () => ({
        getDecision: async () => ({ permitted: true, organizationRole: "MEMBER" }),
        getProjectAnyDecision: async (input): Promise<PermissionDecision> =>
          input.projectId === PROJECT && input.permissions.includes("traces:view")
            ? { permitted: true, organizationRole: "MEMBER" }
            : { permitted: false, organizationRole: "MEMBER", denialReason: "no-binding" },
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members,
  }).mount(storedObjectTrpcTransport, () => app);

  const rest = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("The signed read asks no credential of the door.");
      },
    },
  }).mount(storedObjectRest.router(), { app: () => app, onError: renderHandled });

  return {
    session: router.createCaller({ actor: { id: "viewer-1" } }),
    noSession: router.createCaller({ actor: null }),
    fetch: (path: string) => rest.fetch(new Request(`http://api.test${path}`)),
  };
}

/** A read seal as the test signer's identity cipher writes one. */
function sealOf(claims: Record<string, unknown>): string {
  return new URLSearchParams({ sig: JSON.stringify(claims) }).toString();
}

describe("storedObjects.getReadUrl and the signed content route", () => {
  describe("given a session viewer with the object's permission", () => {
    /** @scenario "A signed-in viewer gets a read URL that serves the object's bytes" */
    it("mints a same-origin URL that serves the bytes", async () => {
      const { session, fetch } = installed();

      const { url } = await session.getReadUrl({ projectId: PROJECT, storedObjectId: OBJECT_ID });
      const response = await fetch(url);

      expect(url.startsWith(`/api/stored-objects/${OBJECT_ID}/content?sig=`)).toBe(true);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
      await expect(response.text()).resolves.toBe(BYTES.toString("utf8"));
    });
  });

  describe("given a viewer asking for another project's object", () => {
    /** @scenario "A viewer is refused a read URL for another project's object" */
    it("refuses before minting anything", async () => {
      const { session } = installed();

      await expect(
        session.getReadUrl({ projectId: OTHER_PROJECT, storedObjectId: OBJECT_ID }),
      ).rejects.toMatchObject({ cause: { code: "permission_denied" } });
    });
  });

  describe("given a request with no session, as a key-only caller is on tRPC", () => {
    /** @scenario "A request without a session cannot mint a read URL" */
    it("refuses as unauthenticated", async () => {
      const { noSession } = installed();

      await expect(
        noSession.getReadUrl({ projectId: PROJECT, storedObjectId: OBJECT_ID }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("given a signature that has been tampered with", () => {
    /** @scenario "A signed read URL refuses a tampered or expired signature" */
    it("answers 401 for a seal that does not open", async () => {
      const { fetch } = installed();

      const response = await fetch(`/api/stored-objects/${OBJECT_ID}/content?sig=forged`);

      expect(response.status).toBe(401);
    });

    it("answers 401 for a seal minted for another object", async () => {
      const { session, fetch } = installed();
      const { url } = await session.getReadUrl({ projectId: PROJECT, storedObjectId: OBJECT_ID });

      const response = await fetch(url.replace(OBJECT_ID, "so_other"));

      expect(response.status).toBe(401);
    });

    it("answers 401 for an upload seal presented as a read", async () => {
      const { fetch } = installed();
      const upload = sealOf({
        projectId: PROJECT,
        objectId: OBJECT_ID,
        byteLength: 1,
        mediaType: "audio/mpeg",
        expiresAt: "2999-01-01T00:00:00.000Z",
      });

      const response = await fetch(`/api/stored-objects/${OBJECT_ID}/content?${upload}`);

      expect(response.status).toBe(401);
    });
  });

  describe("given a signature past its expiry", () => {
    /** @scenario "A signed read URL refuses a tampered or expired signature" */
    it("answers 401 and serves nothing", async () => {
      const { fetch } = installed();
      const lapsed = sealOf({
        kind: "read",
        projectId: PROJECT,
        objectId: OBJECT_ID,
        expiresAt: "2000-01-01T00:00:00.000Z",
      });

      const response = await fetch(`/api/stored-objects/${OBJECT_ID}/content?${lapsed}`);

      expect(response.status).toBe(401);
    });
  });
});

/** A refusal reaches the caller at its own status. */
const renderHandled: ErrorHandler = (error) => {
  const status =
    ("status" in error && typeof error.status === "number" && error.status) ||
    ("httpStatus" in error && typeof error.httpStatus === "number" && error.httpStatus) ||
    500;

  return new Response(JSON.stringify({ error: error.message }), { status });
};
