/**
 * `langwatch whoami` on the CLI output port: `-o json` (and `-o yaml`, `--jq`)
 * project a secret-free machine-readable snapshot from the persisted login
 * (~/.langwatch/config.json), while the bare command keeps its human-readable
 * output. Driven through the REAL command tree (`buildProgram`) so the port's
 * own resolution and serialization are exercised, not stubbed.
 *
 * Feature: specs/typescript-sdk/cli-cross-project-access.feature
 * Rule: whoami -o json prints a secret-free machine-readable snapshot
 *
 * Only `loadConfig` is mocked — the persisted config. `isLoggedIn` is the real
 * pure function (it reads `access_token`), so the logged-in / logged-out split
 * is the shipped rule, not a test double of it.
 *
 * gitleaks:allow — test fixture keys only (not real secrets)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as GovernanceConfigModule from "@/cli/utils/governance/config";

const loadConfig = vi.fn();
vi.mock("@/cli/utils/governance/config", async (importActual) => {
  const actual = await importActual<typeof GovernanceConfigModule>();
  return { ...actual, loadConfig: () => loadConfig() };
});

// buildProgram() reads the tsup-injected __CLI_VERSION__ build constant, which
// no test runner defines (see program-error-contract.unit.test.ts).
(globalThis as Record<string, unknown>).__CLI_VERSION__ ??= "0.0.0-test";

// Agent-mode env would flip the resolved format to "agents"; clear it so an
// explicit `-o json` is what the port sees.
const AGENT_ENV = ["CLAUDECODE", "CLAUDE_CODE", "CURSOR_TRACE_ID"];

/** A logged-in config with every secret-shaped field populated, so a test
 * that asserts those fields are absent from the output is actually proving
 * something got filtered rather than never having been there. */
const LOGGED_IN_CONFIG_WITH_SECRETS = {
  access_token: "fake-access-token",
  gateway_url: "https://gateway.langwatch.ai",
  control_plane_url: "https://app.langwatch.ai",
  user: { id: "user_1", email: "dev@acme.test", name: "Dev User" },
  organization: { id: "org_1", slug: "acme", name: "Acme" },
  personal_project: {
    id: "proj_personal",
    slug: "personal-dev",
    name: "Personal Workspace",
    api_key: "fake-api-key",
  },
  default_personal_vk: {
    id: "vk_1",
    secret: "fake-secret",
    prefix: "pkey_abc",
  },
  default_personal_ingest_keys: {
    ingest_key: "fake-ingest-key",
  },
  cli_api_key: "fake-cli-api-key",
  cli_api_key_scope: {
    kind: "organization" as const,
    project_ids: [],
    permissions: ["scenarios:manage", "prompts:view"],
  },
};

/** Recursively collects every key name and every string value in an object,
 * so the secret-shape assertions do not depend on knowing the object's
 * exact structure. */
const collectKeysAndStrings = (
  value: unknown,
  keys: string[] = [],
  strings: string[] = [],
): { keys: string[]; strings: string[] } => {
  if (typeof value === "string") {
    strings.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectKeysAndStrings(item, keys, strings);
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      keys.push(key);
      collectKeysAndStrings(nested, keys, strings);
    }
  }
  return { keys, strings };
};

const SECRET_PREFIXES = ["sk-lw-", "ik-lw-", "pkey_"];
const FORBIDDEN_KEYS = [
  "api_key",
  "cli_api_key",
  "secret",
  "default_personal_ingest_keys",
  "default_personal_vk",
];

let stdout: string[] = [];
let stderr: string[] = [];
let exited: number[] = [];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(AGENT_ENV.map((n) => [n, process.env[n]]));
  for (const name of AGENT_ENV) delete process.env[name];
  stdout = [];
  stderr = [];
  exited = [];
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    stdout.push(String(line));
  });
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    stderr.push(String(line));
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  });
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exited.push(code ?? 0);
    return undefined as never;
  }) as never);
});

afterEach(() => {
  for (const name of AGENT_ENV) {
    const value = savedEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
});

const runWhoami = async (argv: string[]): Promise<void> => {
  const { buildProgram } = await import("../../program.js");
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["whoami", ...argv], { from: "user" });
};

describe("given a config with every secret-shaped field populated", () => {
  describe("when the user is logged in and runs whoami -o json", () => {
    beforeEach(() => {
      loadConfig.mockReturnValue(LOGGED_IN_CONFIG_WITH_SECRETS);
    });

    /** @scenario "whoami -o json prints one secret-free JSON object and exits 0" */
    it("prints exactly one JSON object to stdout", async () => {
      await runWhoami(["-o", "json"]);

      expect(stdout).toHaveLength(1);
      expect(() => JSON.parse(stdout[0]!)).not.toThrow();
    });

    /** @scenario "whoami -o json prints one secret-free JSON object and exits 0" */
    it("shapes the object with user, organization, personal_project, cli_api_key_scope, gateway_url and control_plane_url", async () => {
      await runWhoami(["-o", "json"]);

      const doc = JSON.parse(stdout[0]!);
      expect(doc).toMatchObject({
        user: { id: "user_1", email: "dev@acme.test", name: "Dev User" },
        organization: { id: "org_1", slug: "acme", name: "Acme" },
        personal_project: {
          id: "proj_personal",
          slug: "personal-dev",
          name: "Personal Workspace",
        },
        cli_api_key_scope: {
          kind: "organization",
          project_ids: [],
          permissions: ["scenarios:manage", "prompts:view"],
        },
        gateway_url: "https://gateway.langwatch.ai",
        control_plane_url: "https://app.langwatch.ai",
      });
    });

    /** @scenario "whoami -o json prints one secret-free JSON object and exits 0" */
    it("omits a field the config does not hold rather than printing it null", async () => {
      loadConfig.mockReturnValue({
        access_token: "fake-access-token",
        gateway_url: "https://gateway.langwatch.ai",
        control_plane_url: "https://app.langwatch.ai",
        // No organization, no cli_api_key_scope on this login.
      });

      await runWhoami(["-o", "json"]);

      const doc = JSON.parse(stdout[0]!);
      expect(doc).not.toHaveProperty("organization");
      expect(doc).not.toHaveProperty("cli_api_key_scope");
    });

    /** @scenario "whoami -o json prints one secret-free JSON object and exits 0" */
    it("contains none of the forbidden secret keys at any depth", async () => {
      await runWhoami(["-o", "json"]);

      const doc = JSON.parse(stdout[0]!);
      const { keys } = collectKeysAndStrings(doc);
      for (const forbidden of FORBIDDEN_KEYS) {
        expect(keys).not.toContain(forbidden);
      }
    });

    /** @scenario "whoami -o json prints one secret-free JSON object and exits 0" */
    it("contains no string value starting with a secret prefix", async () => {
      await runWhoami(["-o", "json"]);

      const doc = JSON.parse(stdout[0]!);
      const { strings } = collectKeysAndStrings(doc);
      for (const value of strings) {
        for (const prefix of SECRET_PREFIXES) {
          expect(value.startsWith(prefix)).toBe(false);
        }
      }
    });

    /** @scenario "whoami -o json prints one secret-free JSON object and exits 0" */
    it("exits 0", async () => {
      await runWhoami(["-o", "json"]);

      expect(exited).toEqual([]);
    });
  });

  describe("when the user is logged in and asks for other machine formats", () => {
    beforeEach(() => {
      loadConfig.mockReturnValue(LOGGED_IN_CONFIG_WITH_SECRETS);
    });

    // The port refuses nothing now that whoami is output-aware: -o yaml and
    // --jq both project from the same `data`, no "does not emit structured
    // output" refusal.
    it("accepts -o yaml and projects the same data", async () => {
      await runWhoami(["-o", "yaml"]);

      const out = stdout.join("\n");
      expect(out).toContain("org_1");
      expect(out).not.toMatch(/does not emit structured output/i);
      expect(exited).toEqual([]);
    });

    it("accepts a --jq dot-path expression", async () => {
      await runWhoami(["--jq", ".organization.id"]);

      expect(stdout.join("\n")).toContain("org_1");
      expect(exited).toEqual([]);
    });
  });

  describe("when the user is not logged in and runs whoami -o json", () => {
    beforeEach(() => {
      loadConfig.mockReturnValue({});
    });

    /** @scenario "whoami -o json when logged out emits a structured error and exits 1" */
    it("prints a structured error document on stdout, not chalk prose", async () => {
      await runWhoami(["-o", "json"]);

      expect(stdout).toHaveLength(1);
      const document = JSON.parse(stdout[0]!) as {
        ok: boolean;
        error: { code: string; message: string };
      };
      expect(document.ok).toBe(false);
      expect(document.error.message).toContain("Not logged in");
    });

    /** @scenario "whoami -o json when logged out emits a structured error and exits 1" */
    it("reports a not_authenticated code, not network_error", async () => {
      await runWhoami(["-o", "json"]);

      const document = JSON.parse(stdout[0]!) as {
        error: { code: string; kind: string };
      };
      expect(document.error.code).toBe("not_authenticated");
      expect(document.error.kind).toBe("not_authenticated");
      expect(document.error.code).not.toBe("network_error");
    });

    /** @scenario "whoami -o json when logged out emits a structured error and exits 1" */
    it("prints the existing Not logged in message on stderr", async () => {
      await runWhoami(["-o", "json"]);

      expect(stderr.join("\n")).toContain("Not logged in");
    });

    /** @scenario "whoami -o json when logged out emits a structured error and exits 1" */
    it("exits 1", async () => {
      await runWhoami(["-o", "json"]);

      expect(exited).toContain(1);
    });
  });

  describe("when the user is logged in and runs whoami without a format flag", () => {
    beforeEach(() => {
      loadConfig.mockReturnValue(LOGGED_IN_CONFIG_WITH_SECRETS);
    });

    /** @scenario "whoami without a format flag keeps its existing human-readable output" */
    it("prints the existing human-readable lines unchanged", async () => {
      await runWhoami([]);

      const out = stdout.join("\n");
      expect(out).toContain("User:         dev@acme.test");
      expect(out).toContain("Name:         Dev User");
      expect(out).toContain("Organization: Acme");
      expect(out).toContain("Login key:    whole organization");
      expect(out).toContain("Permissions:  prompts:view, scenarios:manage");
      expect(out).toContain("Gateway:      https://gateway.langwatch.ai");
      expect(out).toContain("Dashboard:    https://app.langwatch.ai");
    });

    /** @scenario "whoami without a format flag keeps its existing human-readable output" */
    it("exits 0", async () => {
      await runWhoami([]);

      expect(exited).toEqual([]);
    });
  });
});
