import {
  type CliHandledError,
  readCliErrorDocument,
} from "@langwatch/langy-contract/cards/handled-error";

/** The CLI error document stdout carried; these cases all expect one. */
function cliErrorDocument(output: unknown): CliHandledError {
  const read = readCliErrorDocument(output);
  if (read.kind !== "error") throw new Error("stdout held no CLI error document");
  return read.error;
}

/**
 * Credential resolution is the first thing every API-calling command does:
 * priority order, session-liveness gate, daemon discipline, both failures.
 * Feature: specs/ai-governance/cli-onboarding/me-credentials.feature
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type * as SessionApiNs from "../governance/session-api";
import type * as ProjectScopeNs from "../projectScope";

// A developer's local .env must not decide whether these tests see a key; the
// scoped loader's `parse` results are stubbed per test below.
vi.mock("dotenv", () => ({ config: vi.fn() }));

// The notice has its own unit suite (identityNotice.unit.test.ts); here it
// only needs to not do file or network I/O.
vi.mock("../identityNotice", () => ({
  maybePrintIdentityNotice: vi.fn(async () => undefined),
}));

// Stored-state boundary: what ~/.langwatch/config.json holds per test.
vi.mock("../governance/config", () => ({
  loadConfig: vi.fn(() => ({ control_plane_url: "https://app.langwatch.ai" })),
  saveConfig: vi.fn(),
  isLoggedIn: vi.fn((cfg: { access_token?: string } | undefined) => !!cfg?.access_token),
}));

// Keep SessionApiError real (the resolver branches on `err.status`), mock only
// the network call.
vi.mock("../governance/session-api", async () => {
  const actual = await vi.importActual<typeof SessionApiNs>("../governance/session-api");
  return { SessionApiError: actual.SessionApiError, fetchPersonalProject: vi.fn() };
});

// The selector itself has its own unit suite (projectScope.unit.test.ts).
// Here only the wiring is under test: that `--project` reaches the resolver,
// that the resolved id becomes the request's project, and that an
// unresolvable value ends the command instead of silently falling back to
// the personal project. `ProjectScopeError` stays real.
vi.mock("../projectScope", async () => {
  const actual = await vi.importActual<typeof ProjectScopeNs>("../projectScope");
  return {
    ProjectScopeError: actual.ProjectScopeError,
    projectScopeErrorLines: actual.projectScopeErrorLines,
    resolveProjectSelector: vi.fn(),
  };
});

import { config } from "dotenv";

import { scopedProjectId } from "../../../internal/credentialContext";
import {
  loginElsewhereMessage,
  loginMadeElsewhere,
  resolveCredentials,
  SESSION_REVALIDATE_WINDOW_MS,
} from "../apiKey";
import { setOutputFormat } from "../errorOutput";
import { loadConfig, saveConfig } from "../governance/config";
import { fetchPersonalProject, SessionApiError } from "../governance/session-api";
import { maybePrintIdentityNotice } from "../identityNotice";
import { ProjectScopeError, resolveProjectSelector } from "../projectScope";

const mockedDotenvConfig = vi.mocked(config);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedSaveConfig = vi.mocked(saveConfig);
const mockedFetchPersonalProject = vi.mocked(fetchPersonalProject);
const mockedNotice = vi.mocked(maybePrintIdentityNotice);
const mockedResolveProjectSelector = vi.mocked(resolveProjectSelector);

const loggedOutConfig = () => ({
  control_plane_url: "https://app.langwatch.ai",
  gateway_url: "https://gateway.langwatch.ai",
});

const loggedInConfig = (extra: Record<string, unknown> = {}) => ({
  ...loggedOutConfig(),
  access_token: "lw_at_test",
  refresh_token: "lw_rt_test",
  ...extra,
});

/** A fresh cached personal project (validated within the window). */
const freshPersonal = (apiKey = "pkey_personal") => ({
  personal_project: {
    id: "proj_1",
    slug: "personal-x",
    name: "Personal Workspace",
    api_key: apiKey,
    validated_at: Math.floor(Date.now() / 1000),
  },
});

/** A cached personal project whose validation clock is past the window. */
const stalePersonal = (apiKey = "pkey_personal") => ({
  personal_project: {
    id: "proj_1",
    slug: "personal-x",
    name: "Personal Workspace",
    api_key: apiKey,
    validated_at: Math.floor((Date.now() - SESSION_REVALIDATE_WINDOW_MS - 60_000) / 1000),
  },
});

describe("resolveCredentials()", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let savedKey: string | undefined;
  let savedEndpoint: string | undefined;

  beforeEach(() => {
    savedKey = process.env.LANGWATCH_API_KEY;
    savedEndpoint = process.env.LANGWATCH_ENDPOINT;
    delete process.env.LANGWATCH_API_KEY;
    delete process.env.LANGWATCH_ENDPOINT;
    mockedDotenvConfig.mockReset();
    mockedLoadConfig.mockReset();
    mockedLoadConfig.mockReturnValue(loggedOutConfig() as never);
    mockedSaveConfig.mockReset();
    mockedFetchPersonalProject.mockReset();
    mockedFetchPersonalProject.mockResolvedValue(null as never);
    mockedNotice.mockClear();
    mockedResolveProjectSelector.mockReset();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.LANGWATCH_API_KEY;
    else process.env.LANGWATCH_API_KEY = savedKey;
    if (savedEndpoint === undefined) delete process.env.LANGWATCH_ENDPOINT;
    else process.env.LANGWATCH_ENDPOINT = savedEndpoint;
    setOutputFormat(undefined);
    vi.restoreAllMocks();
  });

  describe("when resolving the API key", () => {
    /** @scenario an explicit --api-key value beats the environment */
    it("prefers an explicit key argument over the environment", async () => {
      process.env.LANGWATCH_API_KEY = "sk-from-env";

      const resolved = await resolveCredentials({ apiKey: "sk-explicit" });

      expect(resolved.source).toBe("flag");
      expect(resolved.apiKey).toBe("sk-explicit");
    });

    it("trims surrounding whitespace off the environment key before use", async () => {
      process.env.LANGWATCH_API_KEY = "  sk-from-env \n";

      const resolved = await resolveCredentials();

      // The published key must be the trimmed one, or `Bearer sk-from-env `
      // 401s with nothing pointing at the stray whitespace.
      expect(resolved.apiKey).toBe("sk-from-env");
    });

    /** @scenario LANGWATCH_API_KEY beats the stored device session */
    it("prefers the environment over a stored device session", async () => {
      process.env.LANGWATCH_API_KEY = "sk-from-env";
      mockedLoadConfig.mockReturnValue(loggedInConfig(freshPersonal()) as never);

      const resolved = await resolveCredentials();

      expect(resolved.source).toBe("env");
      expect(resolved.apiKey).toBe("sk-from-env");
      expect(mockedFetchPersonalProject).not.toHaveBeenCalled();
    });

    /** @scenario a device session resolves the personal project API key when no env var is set */
    it("falls back to the device session's personal project key", async () => {
      mockedLoadConfig.mockReturnValue(loggedInConfig(freshPersonal()) as never);

      const resolved = await resolveCredentials();

      expect(resolved.source).toBe("session");
      expect(resolved.apiKey).toBe("pkey_personal");
      expect(mockedNotice).toHaveBeenCalledWith(expect.objectContaining({ mode: "device" }));
    });

    it("lazily exchanges the personal key once and persists it for old sessions", async () => {
      mockedLoadConfig.mockReturnValue(loggedInConfig() as never);
      mockedFetchPersonalProject.mockResolvedValue({
        id: "proj_1",
        slug: "personal-x",
        name: "Personal Workspace",
        api_key: "pkey_lazy",
      } as never);

      const resolved = await resolveCredentials();

      expect(resolved.apiKey).toBe("pkey_lazy");
      expect(mockedSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          personal_project: expect.objectContaining({
            api_key: "pkey_lazy",
            validated_at: expect.any(Number),
          }),
        }),
      );
    });
  });

  describe("when the login minted a user-scoped CLI key", () => {
    it("prefers the login key over the personal project's own key", async () => {
      mockedLoadConfig.mockReturnValue(
        loggedInConfig({
          ...freshPersonal(),
          cli_api_key: "sk-lw-lookup01_secret01",
        }) as never,
      );

      const resolved = await resolveCredentials();

      expect(resolved.apiKey).toBe("sk-lw-lookup01_secret01");
      // The key reaches further, but the request still names the project the
      // command pointed at before this feature.
      expect(resolved.projectId).toBe("proj_1");
    });

    it("keeps LANGWATCH_API_KEY ahead of the login key", async () => {
      process.env.LANGWATCH_API_KEY = "sk-from-env";
      mockedLoadConfig.mockReturnValue(
        loggedInConfig({
          ...freshPersonal(),
          cli_api_key: "sk-lw-lookup01_secret01",
        }) as never,
      );

      const resolved = await resolveCredentials();

      expect(resolved.source).toBe("env");
      expect(resolved.apiKey).toBe("sk-from-env");
    });

    it("wipes the login key too when the session turns out to be revoked", async () => {
      const cfg = loggedInConfig({
        ...stalePersonal(),
        cli_api_key: "sk-lw-lookup01_secret01",
        cli_api_key_scope: { kind: "organization", project_ids: [] },
      });
      mockedLoadConfig.mockReturnValue(cfg as never);
      mockedFetchPersonalProject.mockRejectedValue(
        new SessionApiError(401, "unauthorized", "Session expired or revoked"),
      );

      await expect(resolveCredentials()).rejects.toThrow("process.exit called");

      // A login key left behind would keep authenticating after the device was
      // revoked — the exact bypass the personal key's wipe exists to close.
      const stored = cfg as {
        cli_api_key?: unknown;
        cli_api_key_scope?: unknown;
      };
      expect(stored.cli_api_key).toBeUndefined();
      expect(stored.cli_api_key_scope).toBeUndefined();
      expect(mockedSaveConfig).toHaveBeenCalled();
    });

    it("targets the project --project names, not the personal project", async () => {
      mockedLoadConfig.mockReturnValue(
        loggedInConfig({
          ...freshPersonal(),
          cli_api_key: "sk-lw-lookup01_secret01",
        }) as never,
      );
      mockedResolveProjectSelector.mockResolvedValue("proj_checkout");

      const resolved = await resolveCredentials({ project: "checkout-agent" });

      expect(mockedResolveProjectSelector).toHaveBeenCalledWith(
        expect.objectContaining({ selector: "checkout-agent" }),
      );
      expect(resolved.projectId).toBe("proj_checkout");
      expect(scopedProjectId()).toBe("proj_checkout");
    });

    it("ends the command when --project names nothing the key can see", async () => {
      mockedLoadConfig.mockReturnValue(
        loggedInConfig({
          ...freshPersonal(),
          cli_api_key: "sk-lw-lookup01_secret01",
        }) as never,
      );
      mockedResolveProjectSelector.mockRejectedValue(
        new ProjectScopeError(
          "project_not_accessible",
          'no accessible project matches "ghost".',
          "ghost",
        ),
      );

      await expect(resolveCredentials({ project: "ghost" })).rejects.toThrow("process.exit called");
      // No silent fallback: the personal project must not become the target.
      expect(scopedProjectId()).not.toBe("proj_1");
    });
  });

  describe("when the session-liveness gate blocks a cached key", () => {
    /** @scenario a device session uses the cached key without a network call while validation is fresh */
    it("uses the cached key without revalidating inside the window", async () => {
      mockedLoadConfig.mockReturnValue(loggedInConfig(freshPersonal()) as never);

      const resolved = await resolveCredentials();

      expect(resolved.apiKey).toBe("pkey_personal");
      expect(mockedFetchPersonalProject).not.toHaveBeenCalled();
    });

    /** @scenario a stale cached key is revalidated before use */
    it("revalidates a stale cached key through the session endpoint", async () => {
      mockedLoadConfig.mockReturnValue(loggedInConfig(stalePersonal()) as never);
      mockedFetchPersonalProject.mockResolvedValue({
        id: "proj_1",
        slug: "personal-x",
        name: "Personal Workspace",
        api_key: "pkey_rotated",
      } as never);

      const resolved = await resolveCredentials();

      expect(mockedFetchPersonalProject).toHaveBeenCalledTimes(1);
      expect(resolved.apiKey).toBe("pkey_rotated");
    });

    /** @scenario device-session revocation severs CLI access and wipes the cached key */
    it("wipes the cached key and reports not-logged-in when the session is revoked", async () => {
      const cfg = loggedInConfig(stalePersonal());
      mockedLoadConfig.mockReturnValue(cfg as never);
      mockedFetchPersonalProject.mockRejectedValue(
        new SessionApiError(401, "unauthorized", "Session expired or revoked"),
      );

      await expect(resolveCredentials()).rejects.toThrow("process.exit called");

      // The cached key was deleted and the wipe persisted.
      expect((cfg as { personal_project?: unknown }).personal_project).toBeUndefined();
      expect(mockedSaveConfig).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    /** @scenario a transient/offline revalidation keeps the last-known key without extending trust */
    it("keeps the last-known key on a transient/offline error without extending the clock", async () => {
      mockedLoadConfig.mockReturnValue(loggedInConfig(stalePersonal()) as never);
      mockedFetchPersonalProject.mockRejectedValue(new Error("network down"));

      const resolved = await resolveCredentials();

      expect(resolved.apiKey).toBe("pkey_personal");
      // Clock NOT reset (no save on the offline path), so the next reachable
      // command revalidates again.
      expect(mockedSaveConfig).not.toHaveBeenCalled();
    });

    it("keeps a legacy-server key (404) and quiets the clock", async () => {
      mockedLoadConfig.mockReturnValue(loggedInConfig(stalePersonal()) as never);
      mockedFetchPersonalProject.mockResolvedValue(null as never); // 404: endpoint missing

      const resolved = await resolveCredentials();

      expect(resolved.apiKey).toBe("pkey_personal");
      expect(mockedSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          personal_project: expect.objectContaining({
            validated_at: expect.any(Number),
          }),
        }),
      );
    });
  });

  describe("when the daemon keeps the resolved key out of the shared env", () => {
    /** @scenario the resolved session key never touches the shared process env */
    it("does not materialize the session key into process.env", async () => {
      mockedLoadConfig.mockReturnValue(loggedInConfig(freshPersonal()) as never);

      await resolveCredentials();

      // The resolved key lives in the request-scoped credential store, never
      // in the shared env a concurrent daemon request could read.
      expect(process.env.LANGWATCH_API_KEY).toBeUndefined();
    });

    it("does not materialize an explicit --api-key into process.env either", async () => {
      await resolveCredentials({ apiKey: "sk-explicit" });

      expect(process.env.LANGWATCH_API_KEY).toBeUndefined();
    });

    it("materialises the config-resolved endpoint for services, without overriding env", async () => {
      mockedLoadConfig.mockReturnValue({
        ...loggedInConfig(freshPersonal()),
        control_plane_url: "http://localhost:5560",
      } as never);

      await resolveCredentials();

      expect(process.env.LANGWATCH_ENDPOINT).toBe("http://localhost:5560");
    });

    it("never overwrites an explicit LANGWATCH_ENDPOINT", async () => {
      process.env.LANGWATCH_ENDPOINT = "https://env.example.com";
      process.env.LANGWATCH_API_KEY = "sk-x";

      await resolveCredentials();

      expect(process.env.LANGWATCH_ENDPOINT).toBe("https://env.example.com");
    });
  });

  describe("given no credential anywhere", () => {
    describe("when the command runs with --format json", () => {
      beforeEach(() => {
        setOutputFormat("json");
      });

      /** @scenario machine callers get the structured missing_api_key document with the same message */
      it("prints a structured error document on stdout and exits nonzero", async () => {
        await expect(resolveCredentials()).rejects.toThrow("process.exit called");

        const stdout = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        const domain = cliErrorDocument(stdout);

        expect(domain).not.toBeNull();
        expect(domain?.kind).toBe("missing_api_key");
        expect(domain?.isHandled).toBe(true);
        expect(domain?.message).toContain("Not logged in");
        expect(domain?.message).toContain("langwatch login");
        expect(domain?.meta?.authUrl).toBe("https://app.langwatch.ai/authorize");
        expect(exitSpy).toHaveBeenCalledWith(1);
      });

      it("keeps stdout free of prose — the document is the whole stream", async () => {
        await expect(resolveCredentials()).rejects.toThrow("process.exit called");

        const stdout = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(() => JSON.parse(stdout)).not.toThrow();
      });
    });

    describe("when the command runs with the default text output", () => {
      /** @scenario no login and no env var yields the not-logged-in error */
      it("prints the not-logged-in guidance on stderr, nothing on stdout, exits 1", async () => {
        setOutputFormat(undefined);

        await expect(resolveCredentials()).rejects.toThrow("process.exit called");

        expect(logSpy).not.toHaveBeenCalled();
        // Full-block equality: pins the copy, the ordering, and the blank
        // lines between sections, not just the presence of fragments. ANSI
        // codes are stripped so a color-forcing environment cannot skew it.
        const stderr = errorSpy.mock.calls
          .map((c: unknown[]) =>
            // eslint-disable-next-line no-control-regex -- strips ANSI codes from chalk output
            String(c[0]).replace(/\u001b\[[0-9;]*m/g, ""),
          )
          .join("\n");
        expect(stderr).toBe(
          [
            "Error: you're not logged in, and LANGWATCH_API_KEY is not set.",
            "",
            "Sign in with your browser, interactively:",
            "  langwatch login",
            "",
            "If you have an API key already, either of these works:",
            "  langwatch login --api-key <key>",
            "  echo 'LANGWATCH_API_KEY=<key>' >> .env",
            "",
            "Create an API key at https://app.langwatch.ai/authorize",
            "",
            "For agents: don't reuse keys outside the project folder, check more options with `langwatch login --help` to help the user",
          ].join("\n"),
        );
        expect(exitSpy).toHaveBeenCalledWith(1);
      });

      it("interpolates a self-hosted LANGWATCH_ENDPOINT into the authorize URL", async () => {
        process.env.LANGWATCH_ENDPOINT = "https://langwatch.acme.internal";
        setOutputFormat(undefined);

        await expect(resolveCredentials()).rejects.toThrow("process.exit called");

        const stderr = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(stderr).toContain("Create an API key at https://langwatch.acme.internal/authorize");
        expect(stderr).not.toContain("<endpoint>");
      });
    });

    describe("given a key that is only whitespace", () => {
      it("fails exactly like a missing key", async () => {
        process.env.LANGWATCH_API_KEY = "   ";
        setOutputFormat("json");

        await expect(resolveCredentials()).rejects.toThrow("process.exit called");

        const stdout = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(cliErrorDocument(stdout)?.kind).toBe("missing_api_key");
      });
    });
  });

  describe("given a login made against another address than the command targets", () => {
    const LOGIN_ADDRESS = "https://app.langwatch.ai";
    const OTHER = "https://langwatch.other.test";
    const stripAnsi = (text: string): string =>
      // eslint-disable-next-line no-control-regex -- strips ANSI escape codes from chalk output
      text.replace(/\u001b\[[0-9;]*m/g, "");
    const loginWithBothKeys = () =>
      loggedInConfig({ ...freshPersonal(), cli_api_key: "sk-lw-login-key" });

    /** @scenario the device session's key is never sent to another address than the one that issued it */
    it("resolves no key of the session and ends naming both addresses", async () => {
      process.env.LANGWATCH_ENDPOINT = OTHER;
      mockedLoadConfig.mockReturnValue(loginWithBothKeys() as never);
      setOutputFormat(undefined);

      await expect(resolveCredentials()).rejects.toThrow("process.exit called");

      const stderr = stripAnsi(errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n"));
      expect(stderr).toBe(
        `Error: ${loginElsewhereMessage({ loginEndpoint: LOGIN_ADDRESS, endpoint: OTHER })}`,
      );
      expect(stderr).toContain(LOGIN_ADDRESS);
      expect(stderr).toContain(OTHER);
      expect(stderr).toContain("langwatch login --device");
      expect(stderr).toContain("unset LANGWATCH_ENDPOINT");
      expect(stderr).not.toContain("sk-lw-login-key");
      expect(stderr).not.toContain("pkey_personal");
      expect(logSpy).not.toHaveBeenCalled();
      expect(mockedFetchPersonalProject).not.toHaveBeenCalled();
      expect(mockedSaveConfig).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    /** @scenario the device session's key is never sent to another address than the one that issued it */
    it("reads the other address from the folder's .env just the same", async () => {
      mockedDotenvConfig.mockReturnValue({
        parsed: { LANGWATCH_ENDPOINT: OTHER },
      } as never);
      mockedLoadConfig.mockReturnValue(loginWithBothKeys() as never);

      await expect(resolveCredentials()).rejects.toThrow("process.exit called");

      expect(mockedFetchPersonalProject).not.toHaveBeenCalled();
      expect(scopedProjectId()).toBeUndefined();
    });

    /** @scenario machine callers get a structured login_endpoint_mismatch document */
    it("prints one structured document on stdout for a machine caller", async () => {
      process.env.LANGWATCH_ENDPOINT = OTHER;
      mockedLoadConfig.mockReturnValue(loginWithBothKeys() as never);
      setOutputFormat("json");

      await expect(resolveCredentials()).rejects.toThrow("process.exit called");

      const stdout = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      const domain = cliErrorDocument(stdout);
      expect(domain?.kind).toBe("login_endpoint_mismatch");
      expect(domain?.isHandled).toBe(true);
      expect(domain?.meta).toMatchObject({
        loginEndpoint: LOGIN_ADDRESS,
        endpoint: OTHER,
      });
      expect(stdout).not.toContain("sk-lw-login-key");
    });

    /** @scenario an API key given for the other address is used as given */
    it("uses a key from LANGWATCH_API_KEY or the flag, paired with the other address", async () => {
      process.env.LANGWATCH_ENDPOINT = OTHER;
      process.env.LANGWATCH_API_KEY = "sk-of-the-other-address";
      mockedLoadConfig.mockReturnValue(loginWithBothKeys() as never);

      const fromEnv = await resolveCredentials();
      const fromFlag = await resolveCredentials({ apiKey: "sk-explicit" });

      expect(fromEnv).toMatchObject({
        apiKey: "sk-of-the-other-address",
        source: "env",
        endpoint: OTHER,
      });
      expect(fromFlag).toMatchObject({
        apiKey: "sk-explicit",
        source: "flag",
        endpoint: OTHER,
      });
      expect(mockedFetchPersonalProject).not.toHaveBeenCalled();
    });

    /** @scenario two spellings of one address are one address */
    it.each([
      "https://APP.langwatch.ai/",
      "https://app.langwatch.ai:443",
      "https://app.langwatch.ai///",
    ])("takes %s for the login's own address", async (spelling) => {
      process.env.LANGWATCH_ENDPOINT = spelling;
      mockedLoadConfig.mockReturnValue(loginWithBothKeys() as never);

      const resolved = await resolveCredentials();

      expect(resolved.source).toBe("session");
      expect(resolved.apiKey).toBe("sk-lw-login-key");
    });

    /** @scenario localhost and 127.0.0.1 are two addresses */
    it("does not take 127.0.0.1 for localhost", async () => {
      process.env.LANGWATCH_ENDPOINT = "http://127.0.0.1:5560";
      mockedLoadConfig.mockReturnValue({
        ...loginWithBothKeys(),
        control_plane_url: "http://localhost:5560",
      } as never);

      await expect(resolveCredentials()).rejects.toThrow("process.exit called");

      expect(loginMadeElsewhere()).toEqual({
        loginEndpoint: "http://localhost:5560",
        endpoint: "http://127.0.0.1:5560",
      });
    });

    it("has nothing to say with no login on the machine", () => {
      process.env.LANGWATCH_ENDPOINT = OTHER;

      expect(loginMadeElsewhere()).toBeUndefined();
    });
  });

  describe("given a .env the caller's shell never exported", () => {
    describe("when it holds LANGWATCH_* keys", () => {
      it("applies them — the .env API key unlocks the command", async () => {
        mockedDotenvConfig.mockReturnValue({
          parsed: { LANGWATCH_API_KEY: "sk-from-dotenv" },
        });

        const resolved = await resolveCredentials();

        expect(resolved.apiKey).toBe("sk-from-dotenv");
      });

      it("never overwrites a variable the environment already has", async () => {
        process.env.LANGWATCH_API_KEY = "sk-real";
        mockedDotenvConfig.mockReturnValue({
          parsed: { LANGWATCH_API_KEY: "sk-from-dotenv" },
        });

        const resolved = await resolveCredentials();

        expect(resolved.apiKey).toBe("sk-real");
      });
    });

    describe("when it holds unrelated secrets", () => {
      const SECRET = "LW_DOTENV_TEST_SECRET";

      afterEach(() => {
        delete process.env[SECRET];
      });

      /** @scenario "the caller's .env still contributes only LANGWATCH_* keys (daemon constraint)" */
      it("does NOT stuff them into process.env (the daemon is long-lived and shared)", async () => {
        mockedDotenvConfig.mockReturnValue({
          parsed: {
            LANGWATCH_API_KEY: "sk-from-dotenv",
            [SECRET]: "postgres://user:pass@host/db",
          },
        });

        await resolveCredentials();

        expect(process.env[SECRET]).toBeUndefined();
      });
    });
  });
});
