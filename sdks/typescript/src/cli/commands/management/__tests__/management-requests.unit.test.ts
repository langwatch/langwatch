/**
 * What the management commands SEND, and what they hand back as machine
 * output. Driven through the command functions with `fetch` stubbed, so the
 * flag grammar, the request it composes and the response it returns are all
 * checked on the path a caller actually takes.
 *
 * @see specs/typescript-sdk/cli-management-apis.feature
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

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateApiKeyCommand } from "../../api-keys/update";
import { addGroupBindingCommand } from "../../groups/bindings";
import { listGroupsCommand } from "../../groups/list";
import { createInvitesCommand } from "../../invites/create";
import { listMembersCommand } from "../../members/list";
import { getOrganizationCommand } from "../../organization/get";
import { listRoleBindingsCommand } from "../../role-bindings/list";
import { listRolesCommand } from "../../roles/list";
import { createScimTokenCommand } from "../../scim-tokens/create";
import { listTeamsCommand } from "../../teams/list";

const noop = (): void => {
  // intentionally empty
};

let mockFetch: ReturnType<typeof vi.fn>;
let logged: string[];

/** The next response `fetch` answers with. */
const respondWith = (body: unknown): void => {
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => body });
};

/** The URL and parsed body of the nth request made. */
const requestAt = (index: number): { url: string; body: unknown; init: RequestInit } => {
  const [url, init] = mockFetch.mock.calls[index] as [string, RequestInit];
  return {
    url,
    init,
    body: init.body ? JSON.parse(init.body as string) : undefined,
  };
};

const lastRequest = (): { url: string; body: unknown; init: RequestInit } =>
  requestAt(mockFetch.mock.calls.length - 1);

beforeEach(() => {
  vi.clearAllMocks();
  logged = [];
  mockFetch = vi.fn();
  global.fetch = mockFetch as unknown as typeof fetch;
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation(noop);
});

describe("role-bindings list", () => {
  describe("when role bindings are listed with a principal type, a principal id and a scope", () => {
    /** @scenario Role bindings list passes principal and scope filters through */
    it("sends every filter unchanged and leaves omitted ones off the request", async () => {
      respondWith({ bindings: [], totalCount: 0 });

      await listRoleBindingsCommand({
        principalType: "api-key",
        principalId: "key_1",
        scopeType: "project",
        scopeId: "project_1",
      });

      const url = new URL(lastRequest().url);
      expect(url.pathname).toBe("/api/role-bindings");
      expect(url.searchParams.get("apiKeyId")).toBe("key_1");
      expect(url.searchParams.get("scopeType")).toBe("PROJECT");
      expect(url.searchParams.get("scopeId")).toBe("project_1");
      // The principal type is a CLI word; the wire field is what it names.
      expect(url.searchParams.get("principalType")).toBeNull();
      expect(url.searchParams.get("userId")).toBeNull();
      expect(url.searchParams.get("groupId")).toBeNull();

      // An unfiltered listing sends no filters at all: an empty filter would
      // match nothing, which is the opposite of "no filter".
      mockFetch.mockClear();
      respondWith({ bindings: [], totalCount: 0 });
      await listRoleBindingsCommand({});
      expect(lastRequest().url).toBe(
        "https://app.langwatch.ai/api/role-bindings",
      );
    });
  });
});

describe("scim-tokens create", () => {
  describe("when a SCIM token is created", () => {
    /** @scenario A SCIM token is printed once with a save-it-now warning */
    it("prints the token value and warns it cannot be retrieved again", async () => {
      const created = {
        id: "scim_1",
        token: "scim-secret-value",
        description: "Okta",
      };
      respondWith(created);

      const result = await createScimTokenCommand({ description: "Okta" });
      result?.table();

      const output = logged.join("\n");
      expect(output).toContain("scim-secret-value");
      expect(output).toContain("It will not be shown again");
      // And the machine payload keeps it too: this is the one moment it exists.
      expect(result?.data).toEqual(created);
    });
  });
});

describe("api-keys update", () => {
  describe("when an API key is updated with repeated binding flags and restricted permissions", () => {
    /** @scenario API key update replaces bindings and sets restricted permissions */
    it("sends exactly the bindings given, and restricted mode with those permissions", async () => {
      respondWith({
        id: "key_1",
        name: "Analyst key",
        description: null,
        keyType: "service",
        assignedToUserId: null,
        createdByUserId: null,
        permissionMode: "restricted",
        permissions: ["project:view", "trace:view"],
        createdAt: "2026-01-01T00:00:00Z",
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
        roleBindings: [],
        bindings: [],
      });

      await updateApiKeyCommand("key_1", {
        binding: ["CUSTOM:PROJECT:project_1", "VIEWER:TEAM:team_1"],
        permission: ["project:view", "trace:view"],
        permissionMode: "restricted",
      });

      const request = lastRequest();
      expect(request.url).toBe("https://app.langwatch.ai/api/api-keys/key_1");
      expect(request.init.method).toBe("PATCH");
      expect(request.body).toEqual({
        permissionMode: "restricted",
        permissions: ["project:view", "trace:view"],
        // Replaced outright: exactly the two given, nothing merged in.
        bindings: [
          { role: "CUSTOM", scopeType: "PROJECT", scopeId: "project_1" },
          { role: "VIEWER", scopeType: "TEAM", scopeId: "team_1" },
        ],
      });
    });
  });
});

describe("invites create", () => {
  describe("when invites are created from repeated email, role and team flags", () => {
    /** @scenario Invites are created from flags and from a JSON file */
    it("resolves each team flag to a team and its role, and the JSON forms produce the same request", async () => {
      const created = { invites: [] };

      respondWith(created);
      await createInvitesCommand({
        email: ["a@example.com"],
        role: ["MEMBER"],
        team: ["team_1:MEMBER", "team_2:VIEWER"],
      });
      const fromFlags = lastRequest();

      expect(fromFlags.url).toBe(
        "https://app.langwatch.ai/api/organization/invites",
      );
      expect(fromFlags.init.method).toBe("POST");
      expect(fromFlags.body).toEqual({
        invites: [
          {
            email: "a@example.com",
            role: "MEMBER",
            teams: [
              { teamId: "team_1", role: "MEMBER" },
              { teamId: "team_2", role: "VIEWER" },
            ],
          },
        ],
      });

      // The same batch as JSON on a file.
      const file = join(
        mkdtempSync(join(tmpdir(), "lw-invites-")),
        "invites.json",
      );
      writeFileSync(file, JSON.stringify((fromFlags.body as { invites: unknown[] }).invites));

      mockFetch.mockClear();
      respondWith(created);
      await createInvitesCommand({ file });
      const fromFile = lastRequest();

      // And on standard input.
      const stdinChunks = JSON.stringify(
        (fromFlags.body as { invites: unknown[] }).invites,
      );
      const listeners = new Map<string, (chunk?: Buffer) => void>();
      const stdinOn = vi
        .spyOn(process.stdin, "on")
        .mockImplementation(((event: string, listener: (chunk?: Buffer) => void) => {
          listeners.set(event, listener);
          if (event === "error") {
            // Every listener is registered by now; feed the document through.
            listeners.get("data")?.(Buffer.from(stdinChunks));
            listeners.get("end")?.();
          }
          return process.stdin;
        }) as typeof process.stdin.on);

      mockFetch.mockClear();
      respondWith(created);
      await createInvitesCommand({ stdin: true });
      const fromStdin = lastRequest();
      stdinOn.mockRestore();

      // All three forms produce the same request.
      expect(fromFile.body).toEqual(fromFlags.body);
      expect(fromStdin.body).toEqual(fromFlags.body);
    });
  });
});

describe("every management family", () => {
  describe("when a management command succeeds", () => {
    /** @scenario Every command returns the full API response as machine output */
    it("returns the API response untouched as data, and renders a table over the same data", async () => {
      // One representative command per family, each answering a response with
      // fields the human table never shows: `data` must still carry them.
      const cases: Array<{
        name: string;
        response: unknown;
        run: () => Promise<{ data: unknown; table: () => void } | void>;
      }> = [
        {
          name: "organization get",
          response: {
            id: "org_1",
            name: "Acme",
            slug: "acme",
            supportContact: null,
            presenceEnabled: true,
            traceSharingEnabled: false,
            primaryIntent: null,
            s3Endpoint: null,
            s3AccessKeyId: null,
            s3Bucket: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-02T00:00:00Z",
          },
          run: () => getOrganizationCommand(),
        },
        {
          name: "members list",
          response: {
            members: [
              {
                userId: "user_1",
                role: "ADMIN",
                disabled: false,
                disabledAt: null,
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
                user: { id: "user_1", name: "Ada", email: "ada@example.com" },
              },
            ],
            totalCount: 1,
          },
          run: () => listMembersCommand(),
        },
        {
          name: "roles list",
          response: {
            roles: [
              {
                id: "role_1",
                name: "Analyst",
                description: null,
                permissions: ["project:view"],
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
              },
            ],
          },
          run: () => listRolesCommand(),
        },
        {
          name: "teams list",
          response: {
            data: [
              {
                id: "team_1",
                name: "Platform",
                slug: "platform",
                organizationId: "org_1",
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
              },
            ],
            pagination: { page: 1, limit: 50, total: 1 },
          },
          run: () => listTeamsCommand(),
        },
        {
          name: "groups list",
          response: {
            data: [
              {
                id: "group_1",
                name: "Data science",
                slug: "data-science",
                externalId: null,
                scimSource: null,
                memberCount: 3,
                bindings: [],
                createdAt: "2026-01-01T00:00:00Z",
              },
            ],
            pagination: { page: 1, limit: 50, total: 1 },
          },
          run: () => listGroupsCommand(),
        },
        {
          name: "groups bindings add",
          response: {
            id: "rb_1",
            role: "MEMBER",
            scopeType: "PROJECT",
            scopeId: "project_1",
          },
          run: () =>
            addGroupBindingCommand("group_1", {
              role: "MEMBER",
              scopeType: "PROJECT",
              scopeId: "project_1",
            }),
        },
        {
          name: "role-bindings list",
          response: {
            bindings: [
              {
                id: "rb_1",
                principal: { type: "user", id: "user_1", name: "Ada" },
                role: "ADMIN",
                customRoleId: null,
                customRoleName: null,
                scopeType: "TEAM",
                scopeId: "team_1",
                scopeName: "Platform",
                createdAt: "2026-01-01T00:00:00Z",
              },
            ],
            totalCount: 1,
          },
          run: () => listRoleBindingsCommand(),
        },
      ];

      for (const testCase of cases) {
        mockFetch.mockClear();
        logged = [];
        respondWith(testCase.response);

        const result = await testCase.run();

        expect(result?.data, `${testCase.name} machine payload`).toEqual(
          testCase.response,
        );
        // Nothing is printed until the human rendering is asked for, so a
        // machine format sees only the document the output port writes.
        expect(logged, `${testCase.name} printed before rendering`).toEqual([]);

        result?.table();
        expect(
          logged.length,
          `${testCase.name} human rendering`,
        ).toBeGreaterThan(0);
      }
    });
  });
});
