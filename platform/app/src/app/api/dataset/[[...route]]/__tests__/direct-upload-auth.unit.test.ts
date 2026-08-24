/**
 * @vitest-environment node
 *
 * Security-critical unit tests for `authorizeDirectUpload` (ADR-032 D4). This is
 * the only auth gate on the browser→S3 direct-upload routes, so it must:
 *   - admit a session member holding `datasets:manage`,
 *   - deny a session member for a foreign project (the IDOR defense → 403),
 *   - reject a request with no credentials → 401,
 *   - reject an API key minted for a different project → 401,
 *   - admit a valid API key for the project (and bump lastUsedAt).
 *
 * The boundaries (`getServerAuthSession`, `probeProjectPermission`,
 * `extractCredentials`, the process App services, `enforceApiKeyCeiling`, and
 * `apiKeyCeilingDenialResponse`) are mocked so the test exercises only the
 * authorization decision logic. Mirrors the experiments-v3 auth-test style.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerAuthSession = vi.fn();
vi.mock("~/server/auth", () => ({
  getServerAuthSession: (...args: unknown[]) => getServerAuthSession(...args),
}));

const probeProjectPermission = vi.fn();
vi.mock("~/server/app-layer/permissions/imperative", () => ({
  probeProjectPermission: (...args: unknown[]) =>
    probeProjectPermission(...args),
}));

const extractCredentials = vi.fn();
const enforceApiKeyCeiling = vi.fn();
const apiKeyCeilingDenialResponse = vi.fn();
vi.mock("~/server/api-key/auth-middleware", () => ({
  extractCredentials: (...args: unknown[]) => extractCredentials(...args),
  enforceApiKeyCeiling: (...args: unknown[]) => enforceApiKeyCeiling(...args),
  apiKeyCeilingDenialResponse: (...args: unknown[]) =>
    apiKeyCeilingDenialResponse(...args),
}));

const tryResolveToken = vi.fn();
const markUsed = vi.fn();
const tryGetProject = vi.fn();

const processApp = {
  apiKeys: {
    tryResolveToken,
    markUsed,
  },
  projects: {
    tryGetById: tryGetProject,
  },
};

import { authorizeDirectUpload } from "../direct-upload-auth";

const PROJECT_ID = "project_OWNED";
const TEAM_ID = "team_OWNED";

/** Minimal Hono Context stand-in for request and process-App access. */
const makeContext = (headers: Record<string, string> = {}) =>
  ({
    req: {
      raw: new Request("http://localhost/api/dataset/direct-upload"),
      header: (name: string) => headers[name],
    },
    get: (name: string) =>
      name === "langwatchApp" ? processApp : undefined,
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  // Default API-key boundary stubs (overridden per-test as needed).
  enforceApiKeyCeiling.mockResolvedValue(undefined);
  apiKeyCeilingDenialResponse.mockReturnValue({
    status: 403,
    message: "denied",
  });
  tryGetProject.mockResolvedValue({ id: PROJECT_ID, teamId: TEAM_ID });
});

describe("authorizeDirectUpload", () => {
  describe("given a logged-in session", () => {
    beforeEach(() => {
      getServerAuthSession.mockResolvedValue({ user: { id: "user_1" } });
    });

    describe("when the member holds datasets:manage on the project", () => {
      it("authorizes and returns the project + team", async () => {
        probeProjectPermission.mockResolvedValue(true);

        // A legit same-site upload carries a positive signal (the CSRF gate now
        // fails closed when both Sec-Fetch-Site and Origin are absent).
        const result = await authorizeDirectUpload(
          makeContext({ "sec-fetch-site": "same-origin" }),
          PROJECT_ID,
        );

        expect(result).toEqual({
          ok: true,
          projectId: PROJECT_ID,
          teamId: TEAM_ID,
        });
        // Session path must never touch the API-key resolver.
        expect(tryResolveToken).not.toHaveBeenCalled();
      });
    });

    describe("when the member targets a foreign project (IDOR)", () => {
      it("denies with 403 and never resolves the team", async () => {
        probeProjectPermission.mockResolvedValue(false);

        // Same-site signal so this exercises the permission denial (IDOR), not
        // the CSRF gate.
        const result = await authorizeDirectUpload(
          makeContext({ "sec-fetch-site": "same-origin" }),
          "project_SOMEONE_ELSE",
        );

        expect(result.ok).toBe(false);
        expect(result).toMatchObject({ ok: false, status: 403 });
        expect(tryGetProject).not.toHaveBeenCalled();
      });
    });

    describe("when the request is forged cross-site (CSRF)", () => {
      it("rejects with 403 on Sec-Fetch-Site: cross-site, before any permission check", async () => {
        probeProjectPermission.mockResolvedValue(true); // would pass if reached

        const result = await authorizeDirectUpload(
          makeContext({ "sec-fetch-site": "cross-site" }),
          PROJECT_ID,
        );

        expect(result).toMatchObject({ ok: false, status: 403 });
        // The CSRF gate fires before the permission check and team resolve.
        expect(probeProjectPermission).not.toHaveBeenCalled();
        expect(tryGetProject).not.toHaveBeenCalled();
      });

      it("rejects when the Origin host differs from the Host (older browser, no Sec-Fetch-Site)", async () => {
        probeProjectPermission.mockResolvedValue(true);

        const result = await authorizeDirectUpload(
          makeContext({
            origin: "https://evil.example",
            host: "app.langwatch.ai",
          }),
          PROJECT_ID,
        );

        expect(result).toMatchObject({ ok: false, status: 403 });
        expect(probeProjectPermission).not.toHaveBeenCalled();
      });

      it("fails CLOSED when neither Sec-Fetch-Site nor Origin is present", async () => {
        probeProjectPermission.mockResolvedValue(true); // would pass if reached

        // No positive same-site signal at all → treated as cross-site, so a
        // cookie-bearing request from a header-stripping context can't slip past.
        const result = await authorizeDirectUpload(makeContext(), PROJECT_ID);

        expect(result).toMatchObject({ ok: false, status: 403 });
        expect(probeProjectPermission).not.toHaveBeenCalled();
        expect(tryGetProject).not.toHaveBeenCalled();
      });
    });

    describe("when the request is same-origin", () => {
      it("proceeds to the permission check on Sec-Fetch-Site: same-origin", async () => {
        probeProjectPermission.mockResolvedValue(true);

        const result = await authorizeDirectUpload(
          makeContext({ "sec-fetch-site": "same-origin" }),
          PROJECT_ID,
        );

        expect(result).toEqual({
          ok: true,
          projectId: PROJECT_ID,
          teamId: TEAM_ID,
        });
        expect(probeProjectPermission).toHaveBeenCalled();
      });
    });
  });

  describe("given no session", () => {
    beforeEach(() => {
      getServerAuthSession.mockResolvedValue(null);
    });

    describe("when the request carries no credentials", () => {
      it("rejects with 401", async () => {
        extractCredentials.mockReturnValue(null);

        const result = await authorizeDirectUpload(makeContext(), PROJECT_ID);

        expect(result.ok).toBe(false);
        expect(result).toMatchObject({ ok: false, status: 401 });
        expect(tryResolveToken).not.toHaveBeenCalled();
      });
    });

    describe("when the API key belongs to a different project", () => {
      it("rejects with 401 (project mismatch)", async () => {
        extractCredentials.mockReturnValue({
          token: "sk-lw-other",
          projectId: null,
        });
        tryResolveToken.mockResolvedValue({
          type: "apiKey",
          apiKeyId: "ak_other",
          project: { id: "project_DIFFERENT", teamId: "team_DIFFERENT" },
        });

        const result = await authorizeDirectUpload(makeContext(), PROJECT_ID);

        expect(result.ok).toBe(false);
        expect(result).toMatchObject({ ok: false, status: 401 });
        expect(markUsed).not.toHaveBeenCalled();
      });
    });

    describe("when the API key is valid for the project", () => {
      it("authorizes, returns the team, and bumps lastUsedAt", async () => {
        extractCredentials.mockReturnValue({
          token: "sk-lw-owned",
          projectId: null,
        });
        tryResolveToken.mockResolvedValue({
          type: "apiKey",
          apiKeyId: "ak_owned",
          project: { id: PROJECT_ID, teamId: TEAM_ID },
        });

        const result = await authorizeDirectUpload(makeContext(), PROJECT_ID);

        expect(result).toEqual({
          ok: true,
          projectId: PROJECT_ID,
          teamId: TEAM_ID,
        });
        // Telemetry parity: lastUsedAt bumped for the resolved API key.
        expect(markUsed).toHaveBeenCalledWith({ id: "ak_owned" });
      });
    });
  });
});
