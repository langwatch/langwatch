/**
 * Regression test for the iter-18 bug: `adminGetServerSideProps` was
 * importing `getSession` from `~/utils/auth-client`, which is the
 * browser-bound BetterAuth React client and has no access to request
 * cookies on the server. This made every /admin SSR load see a null
 * session and 404 even for genuine admin users.
 *
 * The fix routes the call through `getServerAuthSession` from
 * `~/server/auth`, which calls `auth.api.getSession({ headers })` with
 * the request headers. This test mocks the helper and verifies (a) the
 * server-side helper is invoked with `req` from the SSR context and
 * (b) the admin gate logic still works against the legacy
 * `session.user.impersonator` shape.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetServerAuthSession = vi.fn();
vi.mock("~/server/auth", () => ({
  getServerAuthSession: (...args: unknown[]) =>
    mockGetServerAuthSession(...args),
}));

const mockIsAdmin = vi.fn();
vi.mock("../isAdmin", () => ({
  isAdmin: (...args: unknown[]) => mockIsAdmin(...args),
}));

import { getServerSideProps } from "../adminGetServerSideProps";

const fakeContext = {
  req: { headers: { cookie: "better-auth.session_token=abc" } },
  res: {},
  resolvedUrl: "/admin",
  query: {},
  params: {},
} as any;

describe("adminGetServerSideProps", () => {
  beforeEach(() => {
    mockGetServerAuthSession.mockReset();
    mockIsAdmin.mockReset();
  });

  describe("when there is no session", () => {
    it("returns notFound", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);
      const result = await getServerSideProps(fakeContext);
      expect(result).toEqual({ notFound: true });
    });
  });

  describe("when the user is not an admin", () => {
    it("returns notFound", async () => {
      mockGetServerAuthSession.mockResolvedValue({
        user: { id: "u1", email: "u@x.com" },
      });
      mockIsAdmin.mockReturnValue(false);

      const result = await getServerSideProps(fakeContext);
      expect(result).toEqual({ notFound: true });
    });
  });

  describe("when the user is an admin", () => {
    it("returns props and forwards req headers to getServerAuthSession", async () => {
      mockGetServerAuthSession.mockResolvedValue({
        user: { id: "admin1", email: "admin@langwatch.ai" },
      });
      mockIsAdmin.mockReturnValue(true);

      const result = await getServerSideProps(fakeContext);
      expect(result).toEqual({ props: {} });
      // CRITICAL: must forward the request, otherwise the server-side
      // session lookup has nothing to read cookies from.
      expect(mockGetServerAuthSession).toHaveBeenCalledWith({
        req: fakeContext.req,
      });
    });
  });

  describe("when an admin is impersonating a non-admin user", () => {
    it("gates on the impersonator identity, not the target", async () => {
      mockGetServerAuthSession.mockResolvedValue({
        user: {
          id: "target1",
          email: "target@customer.com",
          impersonator: {
            id: "admin1",
            email: "admin@langwatch.ai",
          },
        },
      });
      // isAdmin must be called with the IMPERSONATOR, not the target.
      mockIsAdmin.mockImplementation((u: { id: string }) => u.id === "admin1");

      const result = await getServerSideProps(fakeContext);
      expect(result).toEqual({ props: {} });
      expect(mockIsAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ id: "admin1" }),
      );
    });
  });
});
