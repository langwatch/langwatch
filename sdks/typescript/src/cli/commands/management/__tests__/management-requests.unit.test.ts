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

/** The success lines the spinner was asked to print, newest last. */
const succeeded = vi.hoisted(() => [] as string[]);

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn((text?: string) => {
      if (text !== undefined) succeeded.push(text);
    }),
    fail: vi.fn(),
  }),
}));

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getApiKeyCommand } from "../../api-keys/get";
import { updateApiKeyCommand } from "../../api-keys/update";
import { addGroupBindingCommand } from "../../groups/bindings";
import { listGroupsCommand } from "../../groups/list";
import { createInvitesCommand } from "../../invites/create";
import { listMembersCommand } from "../../members/list";
import { getOrganizationCommand } from "../../organization/get";
import { listRoleBindingsCommand } from "../../role-bindings/list";
import { updateRoleBindingCommand } from "../../role-bindings/update";
import { listRolesCommand } from "../../roles/list";
import { createScimTokenCommand } from "../../scim-tokens/create";
import { revokeScimTokenCommand } from "../../scim-tokens/revoke";
import { listTeamsCommand } from "../../teams/list";
import {
  CREATED_GROUP_BINDING_RESPONSE,
  LIST_GROUPS_RESPONSE,
  LIST_MEMBERS_RESPONSE,
  LIST_ROLE_BINDINGS_RESPONSE,
  LIST_ROLES_RESPONSE,
  LIST_TEAMS_RESPONSE,
  ORGANIZATION_SETTINGS_RESPONSE,
  UPDATED_API_KEY_RESPONSE,
} from "./management-response.fixtures";

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
  succeeded.length = 0;
  // The real resolver publishes the key it found into the credential holder;
  // the mock above does not, so the environment stands in as the source the
  // services read.
  process.env.LANGWATCH_API_KEY = "test-key";
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

describe("role-bindings update", () => {
  describe("when a role binding is updated with a new role", () => {
    /** @scenario Role bindings update changes the role a binding grants */
    it("patches that binding with the role, carrying a custom role id only when one is given", async () => {
      const binding = LIST_ROLE_BINDINGS_RESPONSE.bindings[0];
      respondWith({ ...binding, role: "CUSTOM", customRoleId: "crole_1" });

      const result = await updateRoleBindingCommand({
        id: "rb_1",
        options: { role: "custom", customRoleId: "crole_1" },
      });

      const { url, body, init } = lastRequest();
      expect(url).toBe("https://app.langwatch.ai/api/role-bindings/rb_1");
      expect(init.method).toBe("PATCH");
      expect(body).toEqual({ role: "CUSTOM", customRoleId: "crole_1" });
      expect(result?.data).toEqual({
        ...binding,
        role: "CUSTOM",
        customRoleId: "crole_1",
      });

      mockFetch.mockClear();
      respondWith(binding);
      await updateRoleBindingCommand({ id: "rb_1", options: { role: "admin" } });
      expect(lastRequest().body).toEqual({ role: "ADMIN" });
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
      respondWith(UPDATED_API_KEY_RESPONSE);

      await updateApiKeyCommand({
        id: "key_1",
        options: {
          binding: ["CUSTOM:PROJECT:project_1", "VIEWER:TEAM:team_1"],
          permission: ["project:view", "trace:view"],
          permissionMode: "restricted",
        },
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

describe("the API key readings", () => {
  /** Both surfaces render a key the same way, so both are asserted. */
  const renderings = [
    { name: "api-keys get", run: () => getApiKeyCommand("key_1") },
    {
      name: "api-keys update",
      run: () => updateApiKeyCommand({ id: "key_1", options: { name: "R" } }),
    },
  ];

  const render = async (
    apiKey: unknown,
    run: () => Promise<{ table: () => void } | void>,
  ): Promise<string> => {
    logged = [];
    respondWith(apiKey);
    const result = await run();
    result?.table();
    return logged.join("\n");
  };

  describe("when a key carries no role bindings", () => {
    /** @scenario A key with no bindings is reported as granting no access */
    it("says the key grants nothing, in every permission mode", async () => {
      // A key's own bindings are the gate the platform applies first, and it
      // never consults the permission mode while resolving one. So an empty
      // binding set is no permission at any scope whatever the mode says, and
      // reporting it as organization-wide would describe a dead credential as
      // a superuser one to the operator checking their own tightening.
      for (const permissionMode of ["all", "readonly", "restricted"]) {
        for (const { name, run } of renderings) {
          const output = await render(
            {
              ...UPDATED_API_KEY_RESPONSE,
              permissionMode,
              permissions: [],
              roleBindings: [],
            },
            run,
          );

          expect(output, `${name} in ${permissionMode} mode`).toContain(
            "No bindings: this key grants no access anywhere.",
          );
          expect(output, `${name} in ${permissionMode} mode`).not.toContain(
            "organization-wide",
          );
          // And the permissions line agrees: there are no bindings for them to
          // come from either.
          expect(output, `${name} in ${permissionMode} mode`).not.toContain(
            "from the bindings",
          );
        }
      }
    });
  });

  describe("when a restricted key holds bindings and explicit permissions", () => {
    /** @scenario A restricted key shows where its access comes from */
    it("prints the permissions it carries and the bindings that grant them", async () => {
      for (const { name, run } of renderings) {
        const output = await render(
          {
            ...UPDATED_API_KEY_RESPONSE,
            permissionMode: "restricted",
            permissions: ["project:view", "trace:view"],
            roleBindings: [
              {
                id: "rb_1",
                role: "CUSTOM",
                scopeType: "PROJECT",
                scopeId: "project_1",
              },
            ],
          },
          run,
        );

        expect(output, name).toContain("project:view, trace:view");
        expect(output, name).toContain("project_1");
        expect(output, name).not.toContain("No bindings");
      }
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
      let fromStdin: ReturnType<typeof lastRequest>;
      try {
        await createInvitesCommand({ readFromStdin: true });
        fromStdin = lastRequest();
      } finally {
        stdinOn.mockRestore();
      }

      // All three forms produce the same request.
      expect(fromFile.body).toEqual(fromFlags.body);
      expect(fromStdin.body).toEqual(fromFlags.body);
    });
  });
});

describe("the paginated listings", () => {
  describe("when a page smaller than the collection is asked for", () => {
    /** @scenario A paginated listing reports the total, not the size of the page */
    it("reports the total the platform holds, whatever the page size was", async () => {
      respondWith({
        ...LIST_TEAMS_RESPONSE,
        pagination: { page: 1, limit: 1, total: 12 },
      });
      await listTeamsCommand({ limit: "1" });
      expect(succeeded[succeeded.length - 1]).toContain("12 teams");

      respondWith({
        ...LIST_GROUPS_RESPONSE,
        pagination: { page: 1, limit: 1, total: 7 },
      });
      await listGroupsCommand({ limit: "1" });
      expect(succeeded[succeeded.length - 1]).toContain("7 groups");
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
          response: ORGANIZATION_SETTINGS_RESPONSE,
          run: () => getOrganizationCommand(),
        },
        {
          name: "members list",
          response: LIST_MEMBERS_RESPONSE,
          run: () => listMembersCommand(),
        },
        {
          name: "roles list",
          response: LIST_ROLES_RESPONSE,
          run: () => listRolesCommand(),
        },
        {
          name: "teams list",
          response: LIST_TEAMS_RESPONSE,
          run: () => listTeamsCommand(),
        },
        {
          name: "groups list",
          response: LIST_GROUPS_RESPONSE,
          run: () => listGroupsCommand(),
        },
        {
          name: "groups bindings add",
          response: CREATED_GROUP_BINDING_RESPONSE,
          run: () =>
            addGroupBindingCommand({
              groupId: "group_1",
              options: {
                role: "MEMBER",
                scopeType: "PROJECT",
                scopeId: "project_1",
              },
            }),
        },
        {
          name: "role-bindings list",
          response: LIST_ROLE_BINDINGS_RESPONSE,
          run: () => listRoleBindingsCommand(),
        },
        {
          // A delete answers a bare acknowledgement, and that is what `data`
          // is: merging the id the caller already holds into it would publish
          // a document the API never sent.
          name: "scim-tokens revoke",
          response: { success: true },
          run: () => revokeScimTokenCommand("scim_1"),
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
