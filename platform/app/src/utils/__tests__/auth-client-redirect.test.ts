// @vitest-environment jsdom
/**
 * Security tests for the same-origin redirect guard, and the callbackURL
 * hand-off around better-auth's stricter relative-path check.
 *
 * Invariants:
 *  - Relative paths starting with `/` pass through
 *  - `//evil.com` is NOT a relative path (protocol-relative URL) → rejected
 *  - Absolute same-origin URLs collapse to their path+query+hash
 *  - Cross-origin URLs are replaced with "/"
 *  - Malformed URLs fall back to "/"
 *  - Paths that normalise to `//host` or `/\host` are replaced with `/`
 *  - Dangerous schemes (javascript:, data:) are rejected
 *
 * Spec: specs/auth/signin-callback-url-unsupported-characters.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { emailSpy, socialSpy, ssoSpy, hardNavigateSpy } = vi.hoisted(() => ({
  emailSpy: vi.fn(),
  socialSpy: vi.fn(),
  ssoSpy: vi.fn(),
  hardNavigateSpy: vi.fn(),
}));

// Stub out the better-auth client so the module can load without network.
vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => ({ data: null, isPending: false, refetch: vi.fn() }),
    signIn: { email: emailSpy, social: socialSpy, sso: ssoSpy },
    signOut: vi.fn().mockResolvedValue({}),
    getSession: vi.fn().mockResolvedValue({ data: null }),
  }),
}));

vi.mock("~/utils/browserNavigation", () => ({
  hardNavigate: hardNavigateSpy,
  replaceLocation: vi.fn(),
  reloadPage: vi.fn(),
}));

import {
  consumeStoredReturnTo,
  safeRedirectTarget,
  signIn,
} from "../auth-client";

const ORIGIN = "https://app.example.com";

describe("safeRedirectTarget", () => {
  describe("when the callbackUrl is a relative path", () => {
    it("allows a simple relative path", () => {
      expect(safeRedirectTarget("/dashboard", ORIGIN)).toBe("/dashboard");
    });

    it("allows nested paths with query and hash", () => {
      expect(safeRedirectTarget("/dashboard?org=acme#section", ORIGIN)).toBe(
        "/dashboard?org=acme#section",
      );
    });
  });

  describe("when the callbackUrl is a protocol-relative URL (//evil.com)", () => {
    it("blocks the redirect and falls back to /", () => {
      expect(safeRedirectTarget("//evil.com/steal", ORIGIN)).toBe("/");
    });
  });

  describe("when the callbackUrl uses backslashes in place of slashes (@regression)", () => {
    // The WHATWG URL parser treats `\` as `/` for special schemes, so a
    // leading `/\`, `\/`, or `\\` is authority-introducing exactly like
    // `//` — a naive `startsWith("//")` check misses it entirely.
    it("blocks /\\evil.com", () => {
      expect(safeRedirectTarget("/\\evil.com/steal", ORIGIN)).toBe("/");
    });

    it("blocks \\/evil.com", () => {
      expect(safeRedirectTarget("\\/evil.com/steal", ORIGIN)).toBe("/");
    });

    it("blocks \\\\evil.com", () => {
      expect(safeRedirectTarget("\\\\evil.com/steal", ORIGIN)).toBe("/");
    });

    it("allows a single backslash inside an otherwise same-origin path", () => {
      expect(safeRedirectTarget("\\settings", ORIGIN)).toBe("/settings");
    });
  });

  describe("when the path normalises to a protocol-relative URL", () => {
    // Dot segments and encoded dots collapse after the same-origin check, so
    // each of these is same-origin yet leaves a path browsers read as `//host`.
    it.each([
      "/.//evil.com",
      "/a/..//evil.com",
      "/./\\evil.com",
      "/%2e//evil.com",
    ])("blocks %s", (input) => {
      expect(safeRedirectTarget(input, ORIGIN)).toBe("/");
    });
  });

  describe("when the callbackUrl is a cross-origin absolute URL", () => {
    it("blocks https://evil.com", () => {
      expect(safeRedirectTarget("https://evil.com/phish", ORIGIN)).toBe("/");
    });

    it("blocks http:// downgrade attacks", () => {
      expect(safeRedirectTarget("http://evil.com/", ORIGIN)).toBe("/");
    });

    it("blocks a subdomain of the same root domain", () => {
      expect(safeRedirectTarget("https://evil.app.example.com/", ORIGIN)).toBe(
        "/",
      );
    });
  });

  describe("when the callbackUrl is the app's own origin", () => {
    it("collapses to just the path+query+hash", () => {
      expect(
        safeRedirectTarget(`${ORIGIN}/settings?tab=general#auth`, ORIGIN),
      ).toBe("/settings?tab=general#auth");
    });

    it("handles just the origin as /", () => {
      expect(safeRedirectTarget(ORIGIN, ORIGIN)).toBe("/");
    });
  });

  describe("when the callbackUrl is undefined or empty", () => {
    it("returns / for undefined", () => {
      expect(safeRedirectTarget(undefined, ORIGIN)).toBe("/");
    });

    it("returns / for empty string", () => {
      expect(safeRedirectTarget("", ORIGIN)).toBe("/");
    });
  });

  describe("when the callbackUrl is a bare word", () => {
    it("treats it as a same-origin relative path (URL() resolves it)", () => {
      // "not a url at all" resolves against ORIGIN to
      // https://app.example.com/not%20a%20url%20at%20all, which is same-origin
      // and therefore safe to redirect to.
      expect(safeRedirectTarget("not a url at all", ORIGIN)).toBe(
        "/not%20a%20url%20at%20all",
      );
    });
  });

  describe("when the callbackUrl uses a dangerous scheme", () => {
    it("blocks javascript: URLs", () => {
      expect(safeRedirectTarget("javascript:alert(1)", ORIGIN)).toBe("/");
    });

    it("blocks data: URLs", () => {
      expect(
        safeRedirectTarget("data:text/html,<script>alert(1)</script>", ORIGIN),
      ).toBe("/");
    });

    it("blocks file: URLs", () => {
      expect(safeRedirectTarget("file:///etc/passwd", ORIGIN)).toBe("/");
    });
  });
});

const AGENT_TESTING_PATH =
  "/acme-x7f2/agent-testing/results/external:scenario_tests/scenariobatch_01K6ZQ8M3V?drawer.open=scenarioRunDetail&drawer.variant=agent-testing&drawer.scenarioRunId=scenariorun_01K6ZQ8N2B&drawer.batchRunId=scenariobatch_01K6ZQ8M3V&drawer.scenarioSetId=scenario_tests";

const AGENT_TESTING_PATH_QUERY_LESS =
  "/acme-x7f2/agent-testing/results/external:scenario_tests/scenariobatch_01K6ZQ8M3V";

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  emailSpy.mockResolvedValue({ error: null, data: {} });
  socialSpy.mockResolvedValue({ error: null, data: {} });
  ssoSpy.mockResolvedValue({ error: null, data: {} });
});

describe("provider sign-in hand-off", () => {
  describe("when the target already passes better-auth's check", () => {
    /** @scenario "An address better-auth already accepts is handed over unchanged" */
    it.each([
      "/dashboard",
      "/p/traces?x=1&y=2",
    ])("hands %s over unchanged and parks nothing", async (target) => {
      await signIn("google", { callbackUrl: target, redirect: false });

      expect(socialSpy.mock.calls[0]![0]).toMatchObject({
        callbackURL: target,
      });
      expect(consumeStoredReturnTo()).toBe("/");
    });
  });

  describe("when the target carries characters better-auth refuses", () => {
    /** @scenario "Addresses better-auth refuses are carried through the resume page" */
    it.each([
      AGENT_TESTING_PATH,
      AGENT_TESTING_PATH_QUERY_LESS,
      "/a#frag",
      "/a~b",
      "/a,b",
    ])("sends %s through the resume page and returns it once", async (target) => {
      await signIn("google", { callbackUrl: target, redirect: false });

      expect(socialSpy.mock.calls[0]![0]).toMatchObject({
        callbackURL: "/auth/resume",
      });
      expect(consumeStoredReturnTo()).toBe(target);
      expect(consumeStoredReturnTo()).toBe("/");
    });
  });
});

describe("consumeStoredReturnTo", () => {
  describe("when the parked target points at another site", () => {
    /** @scenario "A parked destination on another site falls back to the home page" */
    it("returns / instead", () => {
      window.sessionStorage.setItem("langwatch.auth.returnTo", "//evil.com");

      expect(consumeStoredReturnTo()).toBe("/");
    });
  });
});

describe("signIn", () => {
  describe("when signing in with a password from a page with a colon in its address", () => {
    /** @scenario "A password sign-in from a page with a colon in its address lands back on that page" */
    it("hands better-auth no callbackURL and navigates straight to the page", async () => {
      await signIn("credentials", {
        email: "someone@example.com",
        password: "correct horse",
        callbackUrl: AGENT_TESTING_PATH,
      });

      expect(emailSpy.mock.calls[0]![0]).toMatchObject({
        callbackURL: undefined,
      });
      expect(hardNavigateSpy).toHaveBeenCalledWith(AGENT_TESTING_PATH);
      // Navigated directly, so nothing is parked for a later landing.
      expect(consumeStoredReturnTo()).toBe("/");
    });
  });

  describe("when signing in with a password from a page whose address better-auth accepts", () => {
    /** @scenario "An address better-auth already accepts is handed over unchanged" */
    it("hands better-auth the address and navigates to it", async () => {
      await signIn("credentials", { callbackUrl: "/dashboard" });

      expect(emailSpy.mock.calls[0]![0]).toMatchObject({
        callbackURL: "/dashboard",
      });
      expect(hardNavigateSpy).toHaveBeenCalledWith("/dashboard");
    });
  });

  describe("when the password sign-in address normalises to a protocol-relative URL", () => {
    /** @scenario "A password sign-in never navigates off the site" */
    it("navigates to the home page instead", async () => {
      await signIn("credentials", { callbackUrl: "/.//evil.com" });

      expect(hardNavigateSpy).toHaveBeenCalledWith("/");
    });
  });

  describe("when signing in with a social provider from a page with a colon in its address", () => {
    /** @scenario "A provider sign-in from a page with a colon in its address resumes there" */
    it("hands better-auth the resume page and parks the page for it", async () => {
      await signIn("google", {
        callbackUrl: AGENT_TESTING_PATH,
        redirect: false,
      });

      expect(socialSpy.mock.calls[0]![0]).toMatchObject({
        callbackURL: "/auth/resume",
      });
      expect(consumeStoredReturnTo()).toBe(AGENT_TESTING_PATH);
    });
  });

  describe("when a social sign-in from an accepted address follows an abandoned one", () => {
    /** @scenario "An abandoned provider sign-in leaves nothing behind for the next one" */
    it("clears the parked page", async () => {
      await signIn("google", {
        callbackUrl: AGENT_TESTING_PATH,
        redirect: false,
      });
      await signIn("google", { callbackUrl: "/dashboard", redirect: false });

      expect(socialSpy.mock.calls[1]![0]).toMatchObject({
        callbackURL: "/dashboard",
      });
      expect(consumeStoredReturnTo()).toBe("/");
    });
  });

  describe("when a password sign-in follows an abandoned provider sign-in", () => {
    /** @scenario "An abandoned provider sign-in leaves nothing behind for the next one" */
    it("clears the parked page", async () => {
      await signIn("google", {
        callbackUrl: AGENT_TESTING_PATH,
        redirect: false,
      });
      await signIn("credentials", { callbackUrl: "/dashboard" });

      expect(consumeStoredReturnTo()).toBe("/");
    });
  });

  describe("when signing in through an organization's connection from a page with a colon in its address", () => {
    /** @scenario "A provider sign-in from a page with a colon in its address resumes there" */
    it("hands better-auth the resume page and parks the page for it", async () => {
      await signIn("ssoc_2f8Qk3", {
        callbackUrl: AGENT_TESTING_PATH,
        redirect: false,
      });

      expect(ssoSpy.mock.calls[0]![0]).toMatchObject({
        callbackURL: "/auth/resume",
      });
      expect(consumeStoredReturnTo()).toBe(AGENT_TESTING_PATH);
    });
  });
});
