/**
 * @vitest-environment node
 *
 * Characterisation of the legacy REST share pair, driven through the real Hono
 * app exactly like the sibling route suites.
 *
 * These two endpoints are published in `openapiLangWatch.json` and are the only
 * share surface an API-key holder has, yet nothing pinned their response. This
 * suite records what they answer today — including the defect below — so the
 * shape cannot drift while the feature is extracted, and so correcting the
 * defect is a diff against a stated expectation rather than a silent change.
 *
 * THE DEFECT: `POST /api/trace/:id/share` answers with `/share/<ShareLink.id>`,
 * but `/share/:id` resolves that segment as the link's TOKEN, and since ADR-057
 * `id` and `token` are independent values on the row. Every link minted through
 * this endpoint therefore points at nothing. The assertion that records it is
 * named for what is wrong, not for what is wanted; changing the route is out of
 * scope for this batch.
 *
 * @see packages/features/share/specs/share.feature
 * @see dev/docs/adr/057-token-gated-trace-sharing.md
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appContextMiddlewareFor } from "~/app/api/middleware/app-context";
import { getApp } from "~/server/app-layer/app";

const mockResolve = vi.fn();
const mockMarkUsed = vi.fn();
const mockExtractCredentials = vi.fn();
const mockEnforceApiKeyCeiling = vi.fn();

vi.mock("~/server/api-key/auth-middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/api-key/auth-middleware")>();
  return {
    ...actual,
    extractCredentials: (...args: unknown[]) => mockExtractCredentials(...args),
    enforceApiKeyCeiling: (...args: unknown[]) => mockEnforceApiKeyCeiling(...args),
  };
});

vi.mock("~/server/db", () => ({ prisma: {} }));

const mockCreateShare = vi.fn();
const mockUnshare = vi.fn();

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(() => ({
    apiKeys: {
      tryResolveToken: mockResolve,
      markUsed: mockMarkUsed,
    },
    share: {
      createShare: mockCreateShare,
      unshare: mockUnshare,
    },
  })),
  tryGetApp: vi.fn(() => null),
}));

const { app: tracesLegacyApp } = await import("../traces-legacy");

const testApp = new Hono();
testApp.use("*", appContextMiddlewareFor(getApp()));
testApp.route("/", tracesLegacyApp);

const TRACE_ID = "trace-abc";
const SHARE_ROW_ID = "share-row-id";
const SHARE_TOKEN = "sharetokensharetokensharetoken12";

function post(path: string, { authenticated = true } = {}) {
  return testApp.request(`http://localhost/api/trace/${TRACE_ID}${path}`, {
    method: "POST",
    headers: authenticated ? { "X-Auth-Token": "test-token" } : {},
  });
}

describe("legacy REST trace sharing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractCredentials.mockReturnValue({
      token: "test-token",
      projectId: "project-123",
    });
    mockResolve.mockResolvedValue({
      type: "apiKey" as const,
      apiKeyId: "key-1",
      project: { id: "project-123", team: { organizationId: "org-1" } },
    });
    mockEnforceApiKeyCeiling.mockResolvedValue(void 0);
    mockCreateShare.mockResolvedValue({
      id: SHARE_ROW_ID,
      token: SHARE_TOKEN,
      resourceType: "TRACE",
      resourceId: TRACE_ID,
      projectId: "project-123",
    });
    mockUnshare.mockResolvedValue(void 0);
  });

  describe("when an API-key holder shares a trace", () => {
    it("mints a TRACE link for the resolved project and nothing else", async () => {
      const response = await post("/share");

      expect(response.status).toBe(200);
      expect(mockCreateShare).toHaveBeenCalledTimes(1);
      expect(mockCreateShare).toHaveBeenCalledWith({
        projectId: "project-123",
        resourceType: "TRACE",
        resourceId: TRACE_ID,
      });
    });

    it("answers with the success envelope the OpenAPI document advertises", async () => {
      const response = await post("/share");

      expect(await response.json()).toEqual({
        status: "success",
        path: `/share/${SHARE_ROW_ID}`,
      });
    });

    it("records the key use only after a successful mint", async () => {
      await post("/share");

      expect(mockMarkUsed).toHaveBeenCalledWith({ id: "key-1" });
    });

    /**
     * DEFECT, recorded rather than fixed. `/share/:id` resolves its segment as
     * the token; the row id resolves to nothing, so this path is dead on
     * arrival. Correcting the route means returning `share.token` here, which
     * flips this assertion — deliberately, and in a change of its own.
     */
    it("returns the row id in the path, which is NOT the token the page resolves", async () => {
      const response = await post("/share");
      const body = await response.json();

      expect(body.path).toBe(`/share/${SHARE_ROW_ID}`);
      expect(body.path).not.toBe(`/share/${SHARE_TOKEN}`);
    });
  });

  describe("when an API-key holder unshares a trace", () => {
    it("revokes every link for the resource", async () => {
      const response = await post("/unshare");

      expect(response.status).toBe(200);
      expect(mockUnshare).toHaveBeenCalledWith({
        projectId: "project-123",
        resourceType: "TRACE",
        resourceId: TRACE_ID,
      });
    });

    it("answers with the bare success envelope", async () => {
      const response = await post("/unshare");

      expect(await response.json()).toEqual({ status: "success" });
    });
  });

  describe("when the request carries no credentials", () => {
    it("refuses the mint without reaching the share service", async () => {
      mockExtractCredentials.mockReturnValue(void 0);

      const response = await post("/share", { authenticated: false });

      expect(response.status).toBe(401);
      expect(mockCreateShare).not.toHaveBeenCalled();
    });

    it("refuses the revoke without reaching the share service", async () => {
      mockExtractCredentials.mockReturnValue(void 0);

      const response = await post("/unshare", { authenticated: false });

      expect(response.status).toBe(401);
      expect(mockUnshare).not.toHaveBeenCalled();
    });
  });
});
