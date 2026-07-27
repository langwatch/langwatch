/**
 * Credential resolution is the first thing every API-calling command does, so
 * its priority order, its daemon discipline, and both renderings of its
 * failure (a `{ ok: false, error: { kind: … } }` document on stdout under
 * `--format json`, human guidance on stderr otherwise) are pinned here.
 *
 * Feature: specs/ai-governance/cli-onboarding/me-credentials.feature
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readCliErrorDocument } from "@langwatch/langy/cards/handled-error";

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
  isLoggedIn: vi.fn(
    (cfg: { access_token?: string } | undefined) => !!cfg?.access_token,
  ),
}));

vi.mock("../governance/session-api", () => ({
  fetchPersonalProject: vi.fn(async () => null),
}));

import { config } from "dotenv";
import { loadConfig, saveConfig } from "../governance/config";
import { fetchPersonalProject } from "../governance/session-api";
import { maybePrintIdentityNotice } from "../identityNotice";
import { resolveCredentials } from "../apiKey";
import { setOutputFormat } from "../errorOutput";

const mockedDotenvConfig = vi.mocked(config);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedSaveConfig = vi.mocked(saveConfig);
const mockedFetchPersonalProject = vi.mocked(fetchPersonalProject);
const mockedNotice = vi.mocked(maybePrintIdentityNotice);

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
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
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

  describe("resolution order", () => {
    /** @scenario an explicit --api-key value beats the environment */
    it("prefers an explicit key argument over the environment", async () => {
      process.env.LANGWATCH_API_KEY = "sk-from-env";

      const resolved = await resolveCredentials({ apiKey: "sk-explicit" });

      expect(resolved.source).toBe("flag");
      expect(resolved.apiKey).toBe("sk-explicit");
      expect(process.env.LANGWATCH_API_KEY).toBe("sk-explicit");
    });

    /** @scenario LANGWATCH_API_KEY beats the stored device session */
    it("prefers the environment over a stored device session", async () => {
      process.env.LANGWATCH_API_KEY = "sk-from-env";
      mockedLoadConfig.mockReturnValue(
        loggedInConfig({
          personal_project: { api_key: "pkey_personal" },
        }) as never,
      );

      const resolved = await resolveCredentials();

      expect(resolved.source).toBe("env");
      expect(resolved.apiKey).toBe("sk-from-env");
      expect(mockedFetchPersonalProject).not.toHaveBeenCalled();
    });

    /** @scenario a device session resolves the personal project API key when no env var is set */
    it("falls back to the device session's personal project key", async () => {
      mockedLoadConfig.mockReturnValue(
        loggedInConfig({
          personal_project: { api_key: "pkey_personal" },
        }) as never,
      );

      const resolved = await resolveCredentials();

      expect(resolved.source).toBe("session");
      expect(resolved.apiKey).toBe("pkey_personal");
      expect(process.env.LANGWATCH_API_KEY).toBe("pkey_personal");
      expect(mockedNotice).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "device" }),
      );
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
          personal_project: expect.objectContaining({ api_key: "pkey_lazy" }),
        }),
      );
    });
  });

  describe("daemon discipline", () => {
    /** @scenario a credential materialised into the environment is never trusted as caller input */
    it("re-resolves from disk when the env value is one it materialised itself", async () => {
      mockedLoadConfig.mockReturnValue(
        loggedInConfig({
          personal_project: { api_key: "pkey_personal" },
        }) as never,
      );
      // Request 1 materialises the session key into the process env.
      await resolveCredentials();
      expect(process.env.LANGWATCH_API_KEY).toBe("pkey_personal");

      // Logout happens between requests: config no longer has a session, but
      // the process-global env still carries the materialised key.
      mockedLoadConfig.mockReturnValue(loggedOutConfig() as never);

      await expect(resolveCredentials()).rejects.toThrow("process.exit called");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("still honours a genuinely caller-provided env value that differs", async () => {
      mockedLoadConfig.mockReturnValue(
        loggedInConfig({
          personal_project: { api_key: "pkey_personal" },
        }) as never,
      );
      await resolveCredentials();

      // A different window's caller provides their own key.
      process.env.LANGWATCH_API_KEY = "sk-caller";
      const resolved = await resolveCredentials();

      expect(resolved.source).toBe("env");
      expect(resolved.apiKey).toBe("sk-caller");
    });
  });

  describe("endpoint materialisation", () => {
    it("materialises the config-resolved endpoint for services, without overriding env", async () => {
      mockedLoadConfig.mockReturnValue({
        ...loggedInConfig({ personal_project: { api_key: "pkey_personal" } }),
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
      /** @scenario machine callers get the structured missing_api_key document with the same message */
      it("prints a structured error document on stdout and exits nonzero", async () => {
        setOutputFormat("json");

        await expect(resolveCredentials()).rejects.toThrow(
          "process.exit called",
        );

        const stdout = logSpy.mock.calls
          .map((c: unknown[]) => String(c[0]))
          .join("\n");
        const domain = readCliErrorDocument(stdout);

        expect(domain).not.toBeNull();
        expect(domain?.kind).toBe("missing_api_key");
        expect(domain?.isHandled).toBe(true);
        expect(domain?.message).toContain("Not logged in");
        expect(domain?.message).toContain("langwatch login");
        expect(domain?.meta?.authUrl).toBe(
          "https://app.langwatch.ai/authorize",
        );
        expect(exitSpy).toHaveBeenCalledWith(1);
      });

      it("keeps stdout free of prose — the document is the whole stream", async () => {
        setOutputFormat("json");

        await expect(resolveCredentials()).rejects.toThrow(
          "process.exit called",
        );

        const stdout = logSpy.mock.calls
          .map((c: unknown[]) => String(c[0]))
          .join("\n");
        expect(() => JSON.parse(stdout)).not.toThrow();
      });
    });

    describe("when the command runs with the default text output", () => {
      /** @scenario no login and no env var yields the not-logged-in error */
      it("prints the not-logged-in guidance on stderr, nothing on stdout, exits 1", async () => {
        setOutputFormat(undefined);

        await expect(resolveCredentials()).rejects.toThrow(
          "process.exit called",
        );

        expect(logSpy).not.toHaveBeenCalled();
        const stderr = errorSpy.mock.calls
          .map((c: unknown[]) => String(c[0]))
          .join("\n");
        expect(stderr).toContain(
          "Error: not logged in and LANGWATCH_API_KEY is not set.",
        );
        expect(stderr).toContain(
          "Easiest: langwatch login          (browser sign-in, no key needed)",
        );
        expect(stderr).toContain(
          "With a key: langwatch login --api-key <key>   or   echo 'LANGWATCH_API_KEY=<key>' >> .env",
        );
        expect(stderr).toContain(
          "Keys live at: https://app.langwatch.ai/authorize",
        );
        expect(exitSpy).toHaveBeenCalledWith(1);
      });
    });

    describe("given a key that is only whitespace", () => {
      it("fails exactly like a missing key", async () => {
        process.env.LANGWATCH_API_KEY = "   ";
        setOutputFormat("json");

        await expect(resolveCredentials()).rejects.toThrow(
          "process.exit called",
        );

        const stdout = logSpy.mock.calls
          .map((c: unknown[]) => String(c[0]))
          .join("\n");
        expect(readCliErrorDocument(stdout)?.kind).toBe("missing_api_key");
      });
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
        expect(process.env.LANGWATCH_API_KEY).toBe("sk-from-dotenv");
      });

      it("never overwrites a variable the environment already has", async () => {
        process.env.LANGWATCH_API_KEY = "sk-real";
        mockedDotenvConfig.mockReturnValue({
          parsed: { LANGWATCH_API_KEY: "sk-from-dotenv" },
        });

        await resolveCredentials();

        expect(process.env.LANGWATCH_API_KEY).toBe("sk-real");
      });
    });

    describe("when it holds unrelated secrets", () => {
      const SECRET = "LW_DOTENV_TEST_SECRET";

      afterEach(() => {
        delete process.env[SECRET];
      });

      /** @scenario the caller's .env still contributes only LANGWATCH_* keys (daemon constraint) */
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
