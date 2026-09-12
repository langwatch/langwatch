/**
 * `langwatch whoami --json`: a secret-free machine-readable snapshot of the
 * persisted login (~/.langwatch/config.json), alongside the existing
 * human-readable output which must stay unchanged.
 *
 * Feature: specs/typescript-sdk/cli-cross-project-access.feature
 * Rule: whoami --json prints a secret-free machine-readable snapshot
 *
 * gitleaks:allow — test fixture keys only (not real secrets)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// loadConfig is the persisted ~/.langwatch/config.json. Each test supplies a
// config carrying every secret-shaped field the command must never leak, so
// the secret-free assertions are load-bearing rather than vacuous.
const loadConfig = vi.fn();
vi.mock("@/cli/utils/governance/config", () => ({
  loadConfig: () => loadConfig(),
  isLoggedIn: (cfg: { access_token?: string } | undefined) =>
    !!cfg?.access_token,
}));

import { whoamiCommand } from "../whoami";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

/** A logged-in config with every secret-shaped field populated, so a test
 * that asserts those fields are absent from --json output is actually
 * proving something got filtered rather than never having been there. */
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

describe("given a config with every secret-shaped field populated", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError((code as number) ?? 0);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when the user is logged in and runs whoami --json", () => {
    beforeEach(() => {
      loadConfig.mockReturnValue(LOGGED_IN_CONFIG_WITH_SECRETS);
    });

    /** @scenario "whoami --json prints one secret-free JSON object and exits 0" */
    it("prints exactly one JSON object to stdout", async () => {
      await whoamiCommand({ json: true });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(() => JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string)).not.toThrow();
    });

    /** @scenario "whoami --json prints one secret-free JSON object and exits 0" */
    it("shapes the object with user, organization, personal_project, cli_api_key_scope, gateway_url and control_plane_url", async () => {
      await whoamiCommand({ json: true });

      const doc = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
      expect(doc).toMatchObject({
        user: { id: "user_1", email: "dev@acme.test", name: "Dev User" },
        organization: { id: "org_1", slug: "acme", name: "Acme" },
        personal_project: { id: "proj_personal", slug: "personal-dev", name: "Personal Workspace" },
        cli_api_key_scope: {
          kind: "organization",
          project_ids: [],
          permissions: ["scenarios:manage", "prompts:view"],
        },
        gateway_url: "https://gateway.langwatch.ai",
        control_plane_url: "https://app.langwatch.ai",
      });
    });

    /** @scenario "whoami --json prints one secret-free JSON object and exits 0" */
    it("omits a field the config does not hold rather than printing it null", async () => {
      loadConfig.mockReturnValue({
        access_token: "fake-access-token",
        gateway_url: "https://gateway.langwatch.ai",
        control_plane_url: "https://app.langwatch.ai",
        // No organization, no cli_api_key_scope on this login.
      });

      await whoamiCommand({ json: true });

      const doc = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
      expect(doc).not.toHaveProperty("organization");
      expect(doc).not.toHaveProperty("cli_api_key_scope");
    });

    /** @scenario "whoami --json prints one secret-free JSON object and exits 0" */
    it("contains none of the forbidden secret keys at any depth", async () => {
      await whoamiCommand({ json: true });

      const doc = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
      const { keys } = collectKeysAndStrings(doc);
      for (const forbidden of FORBIDDEN_KEYS) {
        expect(keys).not.toContain(forbidden);
      }
    });

    /** @scenario "whoami --json prints one secret-free JSON object and exits 0" */
    it("contains no string value starting with a secret prefix", async () => {
      await whoamiCommand({ json: true });

      const doc = JSON.parse(consoleLogSpy.mock.calls[0]?.[0] as string);
      const { strings } = collectKeysAndStrings(doc);
      for (const value of strings) {
        for (const prefix of SECRET_PREFIXES) {
          expect(value.startsWith(prefix)).toBe(false);
        }
      }
    });

    /** @scenario "whoami --json prints one secret-free JSON object and exits 0" */
    it("exits 0", async () => {
      await whoamiCommand({ json: true });

      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe("when the user is not logged in and runs whoami --json", () => {
    beforeEach(() => {
      loadConfig.mockReturnValue({});
    });

    /** @scenario "whoami --json when logged out fails on stderr with nothing on stdout" */
    it("exits 1", async () => {
      await expect(whoamiCommand({ json: true })).rejects.toMatchObject({ code: 1 });
    });

    /** @scenario "whoami --json when logged out fails on stderr with nothing on stdout" */
    it("prints the existing Not logged in message on stderr", async () => {
      await expect(whoamiCommand({ json: true })).rejects.toThrow(ProcessExitError);

      const errOut = consoleErrorSpy.mock.calls.flat().join("\n");
      expect(errOut).toContain("Not logged in");
    });

    /** @scenario "whoami --json when logged out fails on stderr with nothing on stdout" */
    it("prints nothing on stdout", async () => {
      await expect(whoamiCommand({ json: true })).rejects.toThrow(ProcessExitError);

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe("when the user is logged in and runs whoami without --json", () => {
    beforeEach(() => {
      loadConfig.mockReturnValue(LOGGED_IN_CONFIG_WITH_SECRETS);
    });

    /** @scenario "whoami without --json keeps its existing human-readable output" */
    it("prints the existing human-readable lines unchanged", async () => {
      await whoamiCommand();

      const out = consoleLogSpy.mock.calls.flat().join("\n");
      expect(out).toContain("User:         dev@acme.test");
      expect(out).toContain("Name:         Dev User");
      expect(out).toContain("Organization: Acme");
      expect(out).toContain("Login key:    whole organization");
      expect(out).toContain("Permissions:  prompts:view, scenarios:manage");
      expect(out).toContain("Gateway:      https://gateway.langwatch.ai");
      expect(out).toContain("Dashboard:    https://app.langwatch.ai");
    });

    /** @scenario "whoami without --json keeps its existing human-readable output" */
    it("exits 0", async () => {
      await whoamiCommand();

      expect(process.exit).not.toHaveBeenCalled();
    });
  });
});
