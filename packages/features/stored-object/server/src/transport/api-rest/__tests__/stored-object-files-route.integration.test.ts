/**
 * @vitest-environment node
 *
 * Characterisation of `GET /api/files/:id` through the real Hono family.
 *
 * The route is the only door between a browser and another tenant's bytes, so
 * what is driven here is the ORDER of its steps as much as its statuses: the
 * throttle is keyed on the caller before any cross-tenant lookup runs, the
 * owning project is resolved from the row and then pinned for both the
 * membership gate and the read, and a storage outage is answered as a 502
 * rather than masked as a deletion.
 *
 * Spec: specs/features/scenarios/externalize-event-byte-content.feature
 */
import { Readable } from "node:stream";
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { StoredObjectOwnerLookupUnavailableError } from "@langwatch/stored-object-contract";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthzPermission } from "@langwatch/authz-contract";
import type { StoredObjectApp, StoredObjectFileRead } from "#app/stored-object.app";
import {
  createFilesRestApp,
  type FilesProjectPermissionCheck,
  type FilesRateLimiter,
} from "../stored-object.api";

const OWNER_PROJECT = "project-owner";
const OBJECT_ID = "stored-object-1";
const BYTES = Buffer.from("audio bytes");

function availableRead(): StoredObjectFileRead {
  return {
    row: {
      id: OBJECT_ID,
      purpose: "scenario_event",
      owner_kind: "scenario_run",
      media_type: "audio/mpeg",
      size_bytes: BYTES.length,
    },
    stream: Readable.from([BYTES]),
  };
}

function missingRead(): StoredObjectFileRead {
  return {
    row: {
      id: OBJECT_ID,
      purpose: "scenario_event",
      owner_kind: "scenario_run",
      media_type: "audio/mpeg",
      size_bytes: BYTES.length,
    },
    status: "missing",
  };
}

describe("given the /api/files family", () => {
  describe("when the row exists and storage holds the bytes", () => {
    /**
     * Also the read half of the suite-coverage scenario: this file drives GET
     * on an existing row, on a row whose storage is missing, and on a row that
     * does not exist. The ingest half — a file part, a dedup hit, a storage PUT
     * failure, the 50MB cap and the project-delete cascade — is driven by the
     * service and scenario-events suites beside it.
     */
    /** @scenario "Integration suite covers every documented ingest and read shape" */
    /** @scenario "GET /api/files/:id streams the bytes for an existing row" */
    it("answers 200 with the stored media type, the stored length and the original bytes", async () => {
      const api = mount({ read: async () => availableRead() });

      const response = await api.fetch(`/api/files/${OBJECT_ID}`);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
      expect(response.headers.get("Content-Length")).toBe(String(BYTES.length));
      await expect(response.text()).resolves.toBe(BYTES.toString("utf8"));
    });
  });

  describe("when the row exists but storage no longer holds the blob", () => {
    /** @scenario "GET /api/files/:id returns 404 with status missing when storage no longer holds the blob" */
    it("answers 404 with a missing status rather than pretending the row is gone", async () => {
      const api = mount({ read: async () => missingRead() });

      const response = await api.fetch(`/api/files/${OBJECT_ID}`);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ status: "missing" });
    });
  });

  describe("when no row exists for the id", () => {
    /** @scenario "GET /api/files/:id returns 404 with status not_found when no row exists for the id" */
    it("answers 404 with a not-found status, distinct from a missing blob", async () => {
      const api = mount({ owner: async () => null });

      const response = await api.fetch(`/api/files/${OBJECT_ID}`);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ status: "not_found" });
    });
  });

  describe("when storage fails with something other than a 404", () => {
    /** @scenario "GET /api/files/:id returns 502 with a friendly message on transient storage failure" */
    it("answers 502 and says the file is temporarily unavailable", async () => {
      const api = mount({
        read: async () => {
          throw new Error("connection reset by peer");
        },
      });

      const response = await api.fetch(`/api/files/${OBJECT_ID}`);

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toEqual({ error: "file temporarily unavailable" });
    });
  });

  describe("when the cross-tenant lookup cannot prove the object is gone", () => {
    /** @scenario "GET /api/files/:id returns 502 with a friendly message on transient storage failure" */
    it("answers 502 rather than a 404 that would read as a deletion", async () => {
      const api = mount({
        owner: async () => {
          throw new StoredObjectOwnerLookupUnavailableError(["org_byoc_down"]);
        },
      });

      const response = await api.fetch(`/api/files/${OBJECT_ID}`);

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toEqual({ error: "file temporarily unavailable" });
    });
  });

  describe("when the caller is authenticated for a different project than the owner", () => {
    /** @scenario "GET /api/files/:id enforces project ownership through the shared permission check" */
    /** @scenario "GET /api/files/:id resolves the owning project from the row id before applying the membership check" */
    it("resolves the owner from the row, refuses on the shared permission check, and streams nothing", async () => {
      const read = vi.fn(async () => availableRead());
      const permissionCheck = vi.fn<FilesProjectPermissionCheck>(async ({ projectId }) => {
        if (projectId !== "project-of-the-caller") {
          throw new HandledError("project_permission_denied", "denied");
        }
      });
      const api = mount({
        read,
        caller: { userId: "user-1" },
        requireProjectPermission: permissionCheck,
      });

      const response = await api.fetch(`/api/files/${OBJECT_ID}`);

      expect(response.status).toBe(403);
      expect(read).not.toHaveBeenCalled();
      // The gate was applied to the project the ROW says owns the object, not
      // to anything the caller supplied.
      expect(permissionCheck.mock.calls.map(([args]) => args.projectId)).toEqual([
        OWNER_PROJECT,
        OWNER_PROJECT,
      ]);
    });
  });

  describe("when the caller has exhausted the per-caller rate limit", () => {
    /** @scenario "GET /api/files/:id throttles by caller identity before any cross-tenant lookup" */
    it("answers 429 keyed on the caller, before the cross-tenant owner lookup runs", async () => {
      const owner = vi.fn(async () => ({ projectId: OWNER_PROJECT }));
      const rateLimit = vi.fn<FilesRateLimiter>(async () => ({ allowed: false, resetAt: 1_000 }));
      const api = mount({ owner, rateLimit });

      const response = await api.fetch(`/api/files/${OBJECT_ID}`);

      expect(response.status).toBe(429);
      expect(owner).not.toHaveBeenCalled();
      expect(rateLimit.mock.calls[0]![0].key).toBe(`files-route:caller:${OWNER_PROJECT}`);
    });
  });

  describe("when the caller presents a browser session and no API key", () => {
    /** @scenario "GET /api/files/:id authenticates a browser via session cookie when no API key header is present" */
    it("authorizes through the session user's project permission and streams the bytes", async () => {
      const permissionCheck = vi.fn<FilesProjectPermissionCheck>(async () => undefined);
      const api = mount({
        read: async () => availableRead(),
        caller: { userId: "user-1" },
        requireProjectPermission: permissionCheck,
      });

      const response = await api.fetch(`/api/files/${OBJECT_ID}`);

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe(BYTES.toString("utf8"));
      expect(permissionCheck).toHaveBeenCalled();
    });
  });

  describe("when the key names the owning project but its own scope does not reach it", () => {
    /** @scenario "A scoped key reading another project's bytes is refused by its own ceiling" */
    it("refuses on the key's ceiling with its own code, and reads nothing", async () => {
      const read = vi.fn(async () => availableRead());
      const api = mount({
        read,
        caller: { apiKeyProjectId: OWNER_PROJECT },
        apiKeyCeiling: async () => {
          throw new HandledError("api_key_permission_denied", "denied", { httpStatus: 403 });
        },
      });

      const response = await api.fetch(`/api/files/${OBJECT_ID}`);

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: "api_key_permission_denied" });
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe("when the key holds only one of the two file-view categories", () => {
    /** @scenario "A scoped key reading another project's bytes is refused by its own ceiling" */
    it("passes on the category it holds rather than requiring both", async () => {
      const asked: AuthzPermission[] = [];
      const api = mount({
        read: async () => availableRead(),
        caller: { apiKeyProjectId: OWNER_PROJECT },
        apiKeyCeiling: async (permission) => {
          asked.push(permission);
          if (permission === "traces:view") {
            throw new HandledError("api_key_permission_denied", "denied", { httpStatus: 403 });
          }
        },
      });

      const response = await api.fetch(`/api/files/${OBJECT_ID}`);

      expect(response.status).toBe(200);
      expect(asked).toEqual(["traces:view", "scenarios:view"]);
    });
  });

  describe("when the caller presents a project API key and no session", () => {
    /** @scenario "GET /api/files/:id authenticates via API key header when no session cookie is present" */
    it("accepts the key scoped to the owning project and never consults a user permission", async () => {
      const permissionCheck = vi.fn<FilesProjectPermissionCheck>(async () => undefined);
      const api = mount({
        read: async () => availableRead(),
        caller: { apiKeyProjectId: OWNER_PROJECT },
        requireProjectPermission: permissionCheck,
      });

      const response = await api.fetch(`/api/files/${OBJECT_ID}`);

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe(BYTES.toString("utf8"));
      expect(permissionCheck).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** The family over one process's stored-object application. */
function mount(options: {
  read?: () => Promise<StoredObjectFileRead | null>;
  owner?: () => Promise<{ projectId: string } | null>;
  caller?: { apiKeyProjectId?: string; userId?: string };
  apiKeyCeiling?: (permission: AuthzPermission) => Promise<void>;
  requireProjectPermission?: FilesProjectPermissionCheck;
  rateLimit?: FilesRateLimiter;
}) {
  const caller = options.caller ?? { apiKeyProjectId: OWNER_PROJECT };
  const app = {
    readById: options.read ?? (async () => availableRead()),
    resolveOwner: options.owner ?? (async () => ({ projectId: OWNER_PROJECT })),
  } as unknown as StoredObjectApp;

  const files = createFilesRestApp({
    security: passThroughSecurity(),
    app: () => app,
    dualAuth: async (c, next) => {
      if (caller.apiKeyProjectId) {
        c.set("apiKeyProjectId", caller.apiKeyProjectId);
        c.set("apiKeyCeiling", options.apiKeyCeiling ?? (async () => undefined));
      }
      if (caller.userId) c.set("userId", caller.userId);
      await next();
    },
    requireProjectPermission: options.requireProjectPermission ?? (async () => undefined),
    rateLimit: options.rateLimit ?? (async () => ({ allowed: true, resetAt: 0 })),
  });
  const hono = new Hono().route("/", files.hono as never);

  return {
    fetch: (path: string) => hono.fetch(new Request(`http://api.test${path}`)),
  };
}

/** A handled refusal reaches the caller at its own status with its own code. */
const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as { status?: number; httpStatus?: number; code?: string };
  const status = handled.status ?? handled.httpStatus;
  if (typeof status === "number") {
    return c.json({ error: handled.code ?? "error" }, status as never);
  }
  return c.json({ error: String(error) }, 500);
};

function passThroughSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: () => noop,
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
