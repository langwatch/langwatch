/**
 * Characterisation of `GET /api/files/:id` through the real declaration.
 * @vitest-environment node
 * Spec: specs/features/scenarios/externalize-event-byte-content.feature
 */
import { Readable } from "node:stream";

import { ProjectMissingCredentialsError } from "@langwatch/api";
import { createRestRuntime } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import {
  StoredObjectNotFoundError,
  StoredObjectOwnerLookupUnavailableError,
} from "@langwatch/stored-object-contract";
import type { ErrorHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { StoredObjectFileStreamRead } from "#app/stored-object.members";
import {
  StoredObjectFileReadService,
  type StoredObjectFileGate,
} from "#services/stored-object-file-read.service";

import { storedObjectFileRest, type StoredObjectFileApi } from "../stored-object-file.rest.ts";

const OWNER_PROJECT = "project-owner";
const OBJECT_ID = "stored-object-1";
const BYTES = Buffer.from("audio bytes");

class ProjectPermissionDeniedTestError extends HandledError {
  constructor() {
    super("project_permission_denied", "denied", { httpStatus: 403, fault: "customer" });
  }
}

function availableRead(): StoredObjectFileStreamRead {
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

/** The same row as `availableRead`, carrying the purpose that maps to `traces:view`. */
function traceContentRead(): StoredObjectFileStreamRead {
  return {
    row: {
      id: OBJECT_ID,
      purpose: "trace_content",
      owner_kind: "trace",
      media_type: "audio/mpeg",
      size_bytes: BYTES.length,
    },
    stream: Readable.from([BYTES]),
  };
}

function missingRead(): StoredObjectFileStreamRead {
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
      await expect(response.json()).resolves.toEqual({ error: "stored_object_missing" });
    });
  });

  describe("when no row exists for the id", () => {
    /** @scenario "GET /api/files/:id returns 404 with status not_found when no row exists for the id" */
    it("answers 404 with a not-found status, distinct from a missing blob", async () => {
      const api = mount({
        owner: async () => {
          throw new StoredObjectNotFoundError();
        },
      });

      const response = await api.fetch(`/api/files/${OBJECT_ID}`);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "stored_object_not_found" });
    });

    it("answers 404 with a not-found status when the owner holds no row", async () => {
      const api = mount({
        read: async () => {
          throw new StoredObjectNotFoundError();
        },
      });

      const response = await api.fetch(`/api/files/${OBJECT_ID}`);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "stored_object_not_found" });
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
      await expect(response.json()).resolves.toEqual({ error: "storage_unavailable" });
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
      await expect(response.json()).resolves.toEqual({ error: "storage_unavailable" });
    });
  });

  describe("when the key belongs to a different project than the owner", () => {
    /** @scenario "GET /api/files/:id enforces project ownership through the shared permission check" */
    /** @scenario "GET /api/files/:id resolves the owning project from the row id before pinning the key to it" */
    /** @scenario "A key reading stored bytes is pinned to the project it authenticated as" */
    it("resolves the owner from the row, refuses the foreign key, and reads nothing", async () => {
      const read = vi.fn(async () => availableRead());
      const owner = vi.fn(async () => ({ projectId: OWNER_PROJECT }));
      const api = mount({ read, owner });

      const response = await api.fetch(`/api/files/${OBJECT_ID}`, keyFor("project-other"));

      expect(response.status).toBe(403);
      expect(owner).toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    });

    it("refuses the foreign key on the project-scoped URL too", async () => {
      const read = vi.fn(async () => availableRead());
      const api = mount({ read });

      const response = await api.fetch(
        `/api/files/${OWNER_PROJECT}/${OBJECT_ID}`,
        keyFor("project-other"),
      );

      expect(response.status).toBe(403);
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe("when the caller has exhausted the per-caller rate limit", () => {
    /** @scenario "GET /api/files/:id throttles by caller identity before any cross-tenant lookup" */
    it("answers 429 keyed on the caller, before the cross-tenant owner lookup runs", async () => {
      const owner = vi.fn(async () => ({ projectId: OWNER_PROJECT }));
      const rateLimit = vi.fn<StoredObjectFileGate["countRead"]>(async () => ({
        allowed: false,
        resetAt: 1_000,
      }));
      const api = mount({ owner, rateLimit });

      const response = await api.fetch(`/api/files/${OBJECT_ID}`);

      expect(response.status).toBe(429);
      expect(owner).not.toHaveBeenCalled();
      expect(rateLimit.mock.calls[0]![0].key).toBe(`files-route:caller:${OWNER_PROJECT}`);
    });
  });

  describe("when the caller presents a browser session and no API key", () => {
    /** @scenario "GET /api/files/:id refuses a session cookie, since REST authenticates with API keys only" */
    it("answers 401 and reads nothing", async () => {
      const read = vi.fn(async () => availableRead());
      const api = mount({ read });

      const response = await api.fetch(`/api/files/${OBJECT_ID}`, {
        cookie: "better-auth.session_token=a-live-session",
      });

      expect(response.status).toBe(401);
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe("when the key reads an object of its own project whose purpose it may not view", () => {
    /** @scenario "An API key reads every stored object of its own project, whatever the purpose" */
    it("streams the bytes and asks no permission", async () => {
      const permissionCheck = vi.fn<StoredObjectFileGate["assertProjectPermission"]>(async () => {
        throw new ProjectPermissionDeniedTestError();
      });
      const api = mount({
        read: async () => availableRead(),
        assertProjectPermission: permissionCheck,
      });

      const response = await api.fetch(`/api/files/${OBJECT_ID}`);

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe(BYTES.toString("utf8"));
      expect(permissionCheck).not.toHaveBeenCalled();
    });
  });

  describe("when the caller presents a project API key and no session", () => {
    /** @scenario "GET /api/files/:id authenticates via API key header when no session cookie is present" */
    it("accepts the key scoped to the owning project and never consults a user permission", async () => {
      const permissionCheck = vi.fn<StoredObjectFileGate["assertProjectPermission"]>(
        async () => undefined,
      );
      const api = mount({
        read: async () => traceContentRead(),
        assertProjectPermission: permissionCheck,
      });

      const response = await api.fetch(`/api/files/${OBJECT_ID}`);

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe(BYTES.toString("utf8"));
      expect(permissionCheck).not.toHaveBeenCalled();
    });
  });

  describe("when the URL names the project that owns the object", () => {
    // The same scenario the membership case above binds; a second annotation
    // would bind nothing it does not already cover.
    it("takes the owner from the path and never runs the cross-tenant lookup", async () => {
      const owner = vi.fn(async () => ({ projectId: OWNER_PROJECT }));
      const api = mount({ read: async () => availableRead(), owner });

      const response = await api.fetch(`/api/files/${OWNER_PROJECT}/${OBJECT_ID}`);

      expect(response.status).toBe(200);
      expect(owner).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** The key a request presents, as the project door reads it: the bearer names its project. */
function keyFor(projectId: string): Record<string, string> {
  return { authorization: `Bearer key-for:${projectId}` };
}

/** The family over one process's byte reads, counter and gate, behind a project-key door. */
function mount(options: {
  read?: () => Promise<StoredObjectFileStreamRead>;
  owner?: () => Promise<{ projectId: string }>;
  assertProjectPermission?: StoredObjectFileGate["assertProjectPermission"];
  rateLimit?: StoredObjectFileGate["countRead"];
}) {
  const files = StoredObjectFileReadService.create({
    countRead: options.rateLimit ?? (async () => ({ allowed: true, resetAt: 0 })),
    assertProjectPermission: options.assertProjectPermission ?? (async () => undefined),
    resolveOwner: options.owner ?? (async () => ({ projectId: OWNER_PROJECT })),
    readById: options.read ?? (async () => availableRead()),
  });
  const api: StoredObjectFileApi = { readFile: (input) => files.read(input) };

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("A byte read asks no permission of its credential.");
      },
      identify: ({ request }) => {
        const bearer = request.headers.get("authorization")?.replace("Bearer key-for:", "");
        if (!bearer) throw new ProjectMissingCredentialsError();

        return { actor: null, scope: { tier: "project", id: bearer } };
      },
    },
  });

  const hono = runtime.mount(storedObjectFileRest.router(), {
    app: () => api,
    credential: "project",
    onError: renderHandled,
  });

  return {
    fetch: (path: string, headers: Record<string, string> = keyFor(OWNER_PROJECT)) =>
      hono.fetch(new Request(`http://api.test${path}`, { headers })),
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
