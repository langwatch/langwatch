/**
 * @vitest-environment node
 *
 * Security-critical unit tests for the direct-upload authorizer (ADR-032 D4).
 * This is the only auth gate on the browser -> S3 direct-upload routes, so it
 * must:
 *   - admit a session member holding `datasets:manage`,
 *   - deny a session member for a foreign project (the IDOR defense -> 403),
 *   - refuse a cookie-authed request that originated cross-site (CSRF),
 *   - reject a request with no credentials -> 401,
 *   - reject an API key minted for a different project -> 401,
 *   - admit a valid API key for the project (and bump lastUsedAt).
 *
 * The two ports are fakes rather than module mocks: since the move, the gate
 * takes the process's ONE session port and its ONE handler-managed credential
 * as arguments, so the decision under test is reachable without standing up
 * either resolver.
 */
import type { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiHandlerManagedCredentials } from "../../../app/api-handler-managed-credential";
import type { ApiHandlerManagedSessionPort } from "../../../app/api-handler-managed-session";
import { createDatasetDirectUploadAuthorizer } from "../dataset-direct-upload-auth";

const PROJECT_ID = "project_1";
const PROJECT = { id: PROJECT_ID, teamId: "team_1", slug: "acme" };

const resolveSession = vi.fn();
const permitted = vi.fn();
const authenticate = vi.fn();
const markUsed = vi.fn();
const tryGetById = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  resolveSession.mockResolvedValue(null);
  permitted.mockResolvedValue(false);
  tryGetById.mockResolvedValue(PROJECT);
});

function authorizer() {
  return createDatasetDirectUploadAuthorizer({
    session: {
      resolve: (request: Request) => resolveSession(request),
      permitted: (input) => permitted(input),
    } as ApiHandlerManagedSessionPort,
    credentials: { authenticate } as unknown as ApiHandlerManagedCredentials,
    projects: () => ({ tryGetById }) as never,
  });
}

/** A request carrying the headers the gate reads, and nothing else. */
function contextWith(headers: Record<string, string> = {}): Context {
  const request = new Request("https://app.langwatch.test/api/dataset/direct-upload", {
    method: "POST",
    headers,
  });
  return {
    req: {
      raw: request,
      header: (name: string) => headers[name.toLowerCase()],
    },
  } as unknown as Context;
}

const sameSite = { "sec-fetch-site": "same-origin" };

describe("given a request carrying a browser session", () => {
  describe("when the person holds datasets:manage on the project", () => {
    it("admits the upload and answers the project's team", async () => {
      resolveSession.mockResolvedValue({ user: { id: "user_1" } });
      permitted.mockResolvedValue(true);

      await expect(authorizer()(contextWith(sameSite), PROJECT_ID)).resolves.toEqual({
        ok: true,
        projectId: PROJECT_ID,
        teamId: "team_1",
      });
      expect(permitted).toHaveBeenCalledWith({
        session: { user: { id: "user_1" } },
        projectId: PROJECT_ID,
        permission: "datasets:manage",
      });
    });
  });

  describe("when the person does not hold the permission on that project", () => {
    it("refuses rather than uploading into a project they cannot write", async () => {
      resolveSession.mockResolvedValue({ user: { id: "user_1" } });
      permitted.mockResolvedValue(false);

      await expect(authorizer()(contextWith(sameSite), PROJECT_ID)).resolves.toMatchObject({
        ok: false,
        status: 403,
      });
    });
  });

  describe("when the cookie-authed request originated cross-site", () => {
    it("refuses before any permission check runs", async () => {
      resolveSession.mockResolvedValue({ user: { id: "user_1" } });
      permitted.mockResolvedValue(true);

      await expect(
        authorizer()(contextWith({ "sec-fetch-site": "cross-site" }), PROJECT_ID),
      ).resolves.toEqual({ ok: false, status: 403, error: "Cross-site request blocked." });
      expect(permitted).not.toHaveBeenCalled();
    });
  });
});

describe("given a request carrying no session", () => {
  describe("when it carries no credential either", () => {
    it("refuses with the credential's own 401 rather than falling through", async () => {
      authenticate.mockResolvedValue({
        ok: false,
        status: 401,
        body: { message: "Authentication token is required." },
      });

      await expect(authorizer()(contextWith(), PROJECT_ID)).resolves.toMatchObject({
        ok: false,
        status: 401,
      });
    });
  });

  describe("when the key was minted for a different project", () => {
    it("refuses rather than writing into the project the body names", async () => {
      authenticate.mockResolvedValue({
        ok: true,
        project: { id: "project_other", teamId: "team_other" },
        markUsed,
      });

      await expect(authorizer()(contextWith(), PROJECT_ID)).resolves.toEqual({
        ok: false,
        status: 401,
        error: "Invalid credentials",
      });
      expect(markUsed).not.toHaveBeenCalled();
    });
  });

  describe("when the key resolves to the project and clears the ceiling", () => {
    it("admits the upload and stamps the credential as used", async () => {
      authenticate.mockResolvedValue({
        ok: true,
        project: { id: PROJECT_ID, teamId: "team_1" },
        markUsed,
      });

      await expect(authorizer()(contextWith(), PROJECT_ID)).resolves.toEqual({
        ok: true,
        projectId: PROJECT_ID,
        teamId: "team_1",
      });
      expect(markUsed).toHaveBeenCalledOnce();
    });
  });

  describe("when the ceiling denies the key", () => {
    it("keeps the denial's own 403 body so a caller reads the same refusal", async () => {
      authenticate.mockResolvedValue({
        ok: false,
        status: 403,
        body: { message: "api key ceiling", code: "forbidden" },
      });

      await expect(authorizer()(contextWith(), PROJECT_ID)).resolves.toEqual({
        ok: false,
        status: 403,
        error: "api key ceiling",
        body: { message: "api key ceiling", code: "forbidden" },
      });
    });
  });
});
