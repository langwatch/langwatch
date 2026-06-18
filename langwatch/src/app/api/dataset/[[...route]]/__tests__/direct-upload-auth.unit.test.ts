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
 * The boundaries (`getServerAuthSession`, `hasProjectPermission`,
 * `extractCredentials`, `TokenResolver`, `enforceApiKeyCeiling`,
 * `apiKeyCeilingDenialResponse`, `prisma`) are mocked so the test exercises only
 * the authorization decision logic. Mirrors the experiments-v3 auth-test style.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerAuthSession = vi.fn();
vi.mock("~/server/auth", () => ({
  getServerAuthSession: (...args: unknown[]) => getServerAuthSession(...args),
}));

const hasProjectPermission = vi.fn();
vi.mock("~/server/api/rbac", () => ({
  hasProjectPermission: (...args: unknown[]) => hasProjectPermission(...args),
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

const resolve = vi.fn();
const markUsed = vi.fn();
vi.mock("~/server/api-key/token-resolver", () => ({
  TokenResolver: {
    create: () => ({
      resolve: (...args: unknown[]) => resolve(...args),
      markUsed: (...args: unknown[]) => markUsed(...args),
    }),
  },
}));

const projectFindUnique = vi.fn();
vi.mock("~/server/db", () => ({
  prisma: {
    project: { findUnique: (...args: unknown[]) => projectFindUnique(...args) },
  },
}));

import { authorizeDirectUpload } from "../direct-upload-auth";

const PROJECT_ID = "project_OWNED";
const TEAM_ID = "team_OWNED";

/** Minimal Hono `Context` stand-in: only `req.raw` and `req.header` are read. */
const makeContext = (headers: Record<string, string> = {}) =>
  ({
    req: {
      raw: new Request("http://localhost/api/dataset/direct-upload"),
      header: (name: string) => headers[name],
    },
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  // Default API-key boundary stubs (overridden per-test as needed).
  enforceApiKeyCeiling.mockResolvedValue(undefined);
  apiKeyCeilingDenialResponse.mockReturnValue({
    status: 403,
    message: "denied",
  });
  projectFindUnique.mockResolvedValue({ teamId: TEAM_ID });
});

describe("authorizeDirectUpload", () => {
  describe("given a logged-in session", () => {
    beforeEach(() => {
      getServerAuthSession.mockResolvedValue({ user: { id: "user_1" } });
    });

    describe("when the member holds datasets:manage on the project", () => {
      it("authorizes and returns the project + team", async () => {
        hasProjectPermission.mockResolvedValue(true);

        const result = await authorizeDirectUpload(makeContext(), PROJECT_ID);

        expect(result).toEqual({
          ok: true,
          projectId: PROJECT_ID,
          teamId: TEAM_ID,
        });
        // Session path must never touch the API-key resolver.
        expect(resolve).not.toHaveBeenCalled();
      });
    });

    describe("when the member targets a foreign project (IDOR)", () => {
      it("denies with 403 and never resolves the team", async () => {
        hasProjectPermission.mockResolvedValue(false);

        const result = await authorizeDirectUpload(
          makeContext(),
          "project_SOMEONE_ELSE",
        );

        expect(result.ok).toBe(false);
        expect(result).toMatchObject({ ok: false, status: 403 });
        expect(projectFindUnique).not.toHaveBeenCalled();
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
        expect(resolve).not.toHaveBeenCalled();
      });
    });

    describe("when the API key belongs to a different project", () => {
      it("rejects with 401 (project mismatch)", async () => {
        extractCredentials.mockReturnValue({
          token: "sk-lw-other",
          projectId: null,
        });
        resolve.mockResolvedValue({
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
        resolve.mockResolvedValue({
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
        expect(markUsed).toHaveBeenCalledWith({ apiKeyId: "ak_owned" });
      });
    });
  });
});
