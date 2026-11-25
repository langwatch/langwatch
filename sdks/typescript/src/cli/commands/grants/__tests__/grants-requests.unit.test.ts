/**
 * What the grants commands SEND, and what `roles list` asks for.
 * @see specs/typescript-sdk/cli-grants.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
  })),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

import { listRolesCommand } from "../../roles/list";
import { changeGrantRoleCommand } from "../change-role";
import { createGrantCommand } from "../create";
import { listGrantsCommand } from "../list";
import { revokeGrantCommand } from "../revoke";

const GRANT = {
  id: "grant_1",
  principal: { type: "user", id: "user_1", name: "Ada" },
  role: { id: "member", name: "Member", builtIn: true },
  scope: { type: "team", id: "team_1", name: "Platform" },
  status: "active",
  expiresAt: null,
  createdAt: "2026-01-01T00:00:00Z",
};

let mockFetch: ReturnType<typeof vi.fn>;
let logged: string[];

const respondWith = (body: unknown): void => {
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => body });
};

const lastRequest = (): { url: string; body: unknown; init: RequestInit } => {
  const [url, init] = mockFetch.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined };
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LANGWATCH_API_KEY = "test-key";
  logged = [];
  mockFetch = vi.fn();
  global.fetch = mockFetch as unknown as typeof fetch;
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("grants list", () => {
  describe("when grants are listed with a principal, a scope type and a status", () => {
    /** @scenario Grants list sends its filters in the grants family's spelling */
    it("sends the wire spellings and leaves omitted filters off the request", async () => {
      respondWith({ grants: [], nextCursor: null });

      await listGrantsCommand({
        principalType: "api-key",
        principalId: "key_1",
        scopeType: "PROJECT",
        status: "active",
      });

      const url = new URL(lastRequest().url);
      expect(url.pathname).toBe("/api/v1/grants/latest");
      expect(url.searchParams.get("principalType")).toBe("apiKey");
      expect(url.searchParams.get("principalId")).toBe("key_1");
      expect(url.searchParams.get("scopeType")).toBe("project");
      expect(url.searchParams.get("status")).toBe("active");
      expect(url.searchParams.get("scopeId")).toBeNull();
      expect(url.searchParams.get("cursor")).toBeNull();
    });
  });

  describe("when the page carries a next cursor", () => {
    /** @scenario Grants list names the cursor of the next page */
    it("prints the cursor to pass for the next page", async () => {
      respondWith({ grants: [GRANT], nextCursor: "1767225600000.Z3JhbnRfMQ" });

      const result = await listGrantsCommand({});
      result?.table?.();

      expect(logged.join("\n")).toContain("--cursor 1767225600000.Z3JhbnRfMQ");
    });
  });
});

describe("grants create", () => {
  describe("when a built-in role is granted to a user on a team with an idempotency key", () => {
    /** @scenario Grants create sends the principal, role and scope, and the idempotency key */
    it("posts the principal, the role id and the lowercase scope, with the key as a header", async () => {
      respondWith(GRANT);

      await createGrantCommand({
        principalType: "user",
        principalId: "user_1",
        role: "member",
        scopeType: "TEAM",
        scopeId: "team_1",
        idempotencyKey: "retry-1",
      });

      const { url, body, init } = lastRequest();
      expect(url).toBe("https://app.langwatch.ai/api/v1/grants/latest");
      expect(init.method).toBe("POST");
      expect(body).toEqual({
        principal: { type: "user", id: "user_1" },
        roleId: "member",
        scope: { type: "team", id: "team_1" },
      });
      expect(new Headers(init.headers).get("Idempotency-Key")).toBe("retry-1");
    });
  });

  describe("when the scope type is not one the grants family knows", () => {
    /** @scenario A scope type the grants family does not know is refused before any request */
    it("fails naming the three scope types and makes no request", async () => {
      const exit = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("exited");
      }) as never);
      const errors: string[] = [];
      vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
      });

      await expect(
        createGrantCommand({
          principalType: "user",
          principalId: "user_1",
          role: "member",
          scopeType: "workspace",
          scopeId: "ws_1",
        }),
      ).rejects.toThrow("exited");

      expect(exit).toHaveBeenCalledWith(1);
      expect(errors.join("\n")).toContain("organization, team, project");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

describe("grants change-role", () => {
  describe("when a grant is changed to another role", () => {
    /** @scenario Grants change-role sends only the new role */
    it("patches that grant with the role id alone", async () => {
      respondWith({ ...GRANT, role: { id: "viewer", name: "Viewer", builtIn: true } });

      await changeGrantRoleCommand({ id: "grant_1", role: "viewer" });

      const { url, body, init } = lastRequest();
      expect(url).toBe("https://app.langwatch.ai/api/v1/grants/latest/grant_1");
      expect(init.method).toBe("PATCH");
      expect(body).toEqual({ roleId: "viewer" });
    });
  });
});

describe("grants revoke", () => {
  describe("when a grant is revoked", () => {
    /** @scenario Grants revoke deletes the grant */
    it("deletes that grant", async () => {
      respondWith({ id: "grant_1", revoked: true });

      const result = await revokeGrantCommand("grant_1");

      const { url, init } = lastRequest();
      expect(url).toBe("https://app.langwatch.ai/api/v1/grants/latest/grant_1");
      expect(init.method).toBe("DELETE");
      expect(result?.data).toEqual({ id: "grant_1", revoked: true });
    });
  });
});

describe("roles list", () => {
  describe("when roles are listed with --built-in, --no-built-in and neither", () => {
    /** @scenario Roles list narrows to the built-in or the custom roles */
    it("sends builtIn true, then false, then no filter", async () => {
      respondWith({ roles: [] });

      await listRolesCommand({ builtIn: true });
      expect(new URL(lastRequest().url).searchParams.get("builtIn")).toBe("true");

      await listRolesCommand({ builtIn: false });
      expect(new URL(lastRequest().url).searchParams.get("builtIn")).toBe("false");

      await listRolesCommand({});
      expect(lastRequest().url).toBe("https://app.langwatch.ai/api/v1/roles/latest");
    });
  });
});
