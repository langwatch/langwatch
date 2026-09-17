import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, revokeOne, resolveAuthProvider } = vi.hoisted(() => ({
  getSession: vi.fn(),
  revokeOne: vi.fn(),
  resolveAuthProvider: vi.fn(),
}));

vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession } },
  SIGN_IN_ERROR_PAGE_URL: "/auth/error",
}));
vi.mock("~/server/app-layer/identity/runtime", () => ({
  sessionRevocation: () => ({ revokeOne }),
}));
vi.mock("@ee/sso/sso-gate", () => ({ resolveAuthProvider }));

import { app } from "../auth";

const session = {
  session: { token: "server-session-token" },
  user: { id: "acme-member" },
};
const logout = (method = "GET") =>
  app.request("/api/auth/logout", {
    method,
    headers: { cookie: "better-auth.session_token=signed-cookie" },
  });

beforeEach(() => {
  getSession.mockReset().mockResolvedValue(session);
  revokeOne.mockReset().mockResolvedValue(void 0);
  resolveAuthProvider.mockReset().mockResolvedValue("email");
});

describe("browser logout", () => {
  it("revokes the resolved session before clearing cookies and confirming sign-out", async () => {
    const response = await logout();

    expect(revokeOne).toHaveBeenCalledWith({
      token: "server-session-token",
      userId: "acme-member",
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/auth/signin?signedOut=1");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  /** @scenario "Logout reports a revocation failure instead of confirming success" */
  it.each([
    "GET",
    "POST",
  ])("returns an error for %s without confirming a failed revocation", async (method) => {
    revokeOne.mockRejectedValueOnce(new Error("session store unavailable"));

    const response = await logout(method);

    expect(response.status).toBe(500);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(resolveAuthProvider).not.toHaveBeenCalled();
  });

  it("allows the same cookie to retry after a temporary failure", async () => {
    revokeOne.mockRejectedValueOnce(new Error("session store unavailable"));
    expect((await logout()).status).toBe(500);

    const retry = await logout();

    expect(retry.status).toBe(302);
    expect(retry.headers.get("location")).toBe("/auth/signin?signedOut=1");
    expect(revokeOne).toHaveBeenCalledTimes(2);
  });

  it("does not confirm logout when session resolution fails", async () => {
    getSession.mockRejectedValueOnce(new Error("session lookup unavailable"));

    const response = await logout();

    expect(response.status).toBe(500);
    expect(response.headers.get("location")).toBeNull();
    expect(revokeOne).not.toHaveBeenCalled();
  });

  it("confirms an already-ended session without trying to revoke another", async () => {
    getSession.mockResolvedValueOnce(null);

    const response = await logout();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/auth/signin?signedOut=1");
    expect(revokeOne).not.toHaveBeenCalled();
  });
});
