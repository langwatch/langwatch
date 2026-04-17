import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
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
    fetchMock = vi.fn(async () =>
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
      const body = JSON.parse(
        fetchMock.mock.calls[0]![1].body as string,
      );
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
      await adminClient.create("organizationFeature", {
        feature: "CUSTOM_EMBEDDINGS",
        organizationId: "org_1",
      });
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({
        resource: "organizationFeature",
        method: "create",
        params: {
          data: { feature: "CUSTOM_EMBEDDINGS", organizationId: "org_1" },
        },
      });
    });
  });

  describe("when the server returns a non-2xx", () => {
    it("throws an Error that includes status and body for visibility", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("boom", { status: 500, statusText: "Server Error" }),
      );
      await expect(
        adminClient.getList("user", {}),
      ).rejects.toThrow(/user\/getList failed \(500\): boom/);
    });
  });
});

describe("impersonateUser", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn(async () =>
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
