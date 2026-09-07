import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
// The logic module rather than `~/features/errors`: the barrel pulls in the
// Chakra toaster, which has no place in a node-environment unit test.
import { readHandledError } from "~/features/errors/logic/readHandledError";

import { adminClient, impersonateUser } from "../adminClient";

/**
 * Pin the request-body shape the admin UI posts to `/api/admin/:resource`.
 * The Hono handler in `ee/admin/routes/admin.ts` reads these exact fields
 * (via ra-data-simple-prisma's `defaultHandler` / `getListHandler`), so any
 * drift here silently breaks the list/update/create flows across every
 * Backoffice resource view.
 */
describe("adminClient", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [], total: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("when calling getList", () => {
    it("posts resource, method, and params under the expected body shape", async () => {
      await adminClient.getList("user", {
        pagination: { page: 2, perPage: 50 },
        sort: { field: "createdAt", order: "DESC" },
        filter: { query: "acme" },
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/admin/user");
      expect(init.method).toBe("POST");
      expect(init.credentials).toBe("include");
      expect(JSON.parse(init.body as string)).toEqual({
        resource: "user",
        method: "getList",
        params: {
          pagination: { page: 2, perPage: 50 },
          sort: { field: "createdAt", order: "DESC" },
          filter: { query: "acme" },
        },
      });
    });

    it("defaults pagination, sort, and filter when params are partial", async () => {
      await adminClient.getList("organization", {});
      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(body.params.pagination).toEqual({ page: 1, perPage: 25 });
      expect(body.params.sort).toEqual({ field: "id", order: "ASC" });
      expect(body.params.filter).toEqual({});
    });
  });

  describe("when calling update", () => {
    it("sends id and data inside params", async () => {
      await adminClient.update("user", "user_123", {
        name: "Jane",
        deactivatedAt: null,
      });
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
        resource: "user",
        method: "update",
        params: { id: "user_123", data: { name: "Jane", deactivatedAt: null } },
      });
    });
  });

  describe("when calling create", () => {
    it("sends data inside params", async () => {
      await adminClient.create("subscription", {
        organizationId: "org_1",
        plan: "GROWTH",
      });
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
        resource: "subscription",
        method: "create",
        params: {
          data: { organizationId: "org_1", plan: "GROWTH" },
        },
      });
    });
  });

  describe("when the server returns a handled failure", () => {
    it("throws it in the shape the error UI reads", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "cannot_impersonate_admin",
            message: "Cannot impersonate another admin",
            userId: "user_target",
            fault: "customer",
            trace: { traceId: "0af7651916cd43dd8448eb211c80319c" },
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
      );

      const error = await adminClient.getList("user", {}).catch((e) => e);

      // The whole point of the shape: the presentation layer can name the
      // failure and hand the operator an id to quote. A bare
      // `new Error("...failed (403): {json}")` gives it neither.
      const handled = readHandledError(error);
      expect(handled?.code).toBe("cannot_impersonate_admin");
      expect(handled?.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
      expect(handled?.meta.userId).toBe("user_target");
      expect(handled?.httpStatus).toBe(403);
    });
  });

  describe("when the server returns a body that isn't JSON", () => {
    it("still names the call and its status, and stays unhandled", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("boom", { status: 500, statusText: "Server Error" }),
      );

      const error = await adminClient.getList("user", {}).catch((e) => e);

      expect((error as Error).message).toMatch(/user\/getList failed \(500\)/);
      // Nothing structured came back, so there is nothing to present — the
      // generic unknown treatment is the correct outcome here (ADR-045).
      expect(readHandledError(error)).toBeNull();
    });
  });
});

describe("impersonateUser", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "ok" }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts userIdToImpersonate and reason to the dedicated impersonate endpoint", async () => {
    await impersonateUser({
      userIdToImpersonate: "user_xyz",
      reason: "Investigating a stuck trace reported by support",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/impersonate");
    expect(init.method).toBe("POST");
    // Cookie-mode auth: the admin session is carried via a same-site
    // cookie, so we must explicitly send credentials. Pinning this here
    // catches a silent regression where a refactor drops the flag and
    // BetterAuth starts rejecting the impersonation as unauthenticated.
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({
      userIdToImpersonate: "user_xyz",
      reason: "Investigating a stuck trace reported by support",
    });
  });
});
