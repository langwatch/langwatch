import { describe, it, expect } from "vitest";
import { extractCredentials, collectAuthDiagnostics } from "../auth-middleware";

function mockGetHeader(headers: Record<string, string>) {
  return (name: string) => headers[name.toLowerCase()] ?? headers[name];
}

function mockHonoCtx(opts: {
  path?: string;
  method?: string;
  headers?: Record<string, string>;
}) {
  return {
    req: {
      path: opts.path ?? "/api/scenario-events",
      method: opts.method ?? "POST",
      header: mockGetHeader(opts.headers ?? {}),
    },
  };
}

describe("extractCredentials", () => {
  describe("when using Basic Auth", () => {
    it("extracts projectId and token from base64-encoded header", () => {
      const encoded = Buffer.from("proj-123:pat-lw-lookup_secret").toString(
        "base64",
      );
      const c = mockGetHeader({ authorization: `Basic ${encoded}` });
      const result = extractCredentials(c);

      expect(result).toEqual({
        token: "pat-lw-lookup_secret",
        projectId: "proj-123",
      });
    });

    it("handles colons in the token value", () => {
      const encoded = Buffer.from("proj:pat-lw-a_b:extra").toString("base64");
      const c = mockGetHeader({ authorization: `Basic ${encoded}` });
      const result = extractCredentials(c);

      expect(result).toEqual({
        token: "pat-lw-a_b:extra",
        projectId: "proj",
      });
    });

    it("returns null for missing colon in decoded value (no fallback)", () => {
      const encoded = Buffer.from("no-colon-here").toString("base64");
      const c = mockGetHeader({ authorization: `Basic ${encoded}` });
      expect(extractCredentials(c)).toBeNull();
    });

    it("returns null for empty projectId or token (no fallback)", () => {
      const encoded1 = Buffer.from(":token").toString("base64");
      const c1 = mockGetHeader({ authorization: `Basic ${encoded1}` });
      expect(extractCredentials(c1)).toBeNull();

      const encoded2 = Buffer.from("proj:").toString("base64");
      const c2 = mockGetHeader({ authorization: `Basic ${encoded2}` });
      expect(extractCredentials(c2)).toBeNull();
    });

    it("falls back to X-Auth-Token when Basic auth is malformed (no colon)", () => {
      // A corporate proxy may add Authorization: Basic <some-base64> for its
      // own upstream auth. That MUST NOT poison the customer's legitimate
      // X-Auth-Token credential — fall through, not return null.
      const badBasic = Buffer.from("internal-proxy-token").toString("base64");
      const c = mockGetHeader({
        authorization: `Basic ${badBasic}`,
        "x-auth-token": "sk-lw-customer-key",
      });
      expect(extractCredentials(c)).toEqual({
        token: "sk-lw-customer-key",
        projectId: null,
      });
    });

    it("falls back to X-Auth-Token when Basic auth has empty token", () => {
      const emptyToken = Buffer.from("projectId:").toString("base64");
      const c = mockGetHeader({
        authorization: `Basic ${emptyToken}`,
        "x-auth-token": "sk-lw-customer-key",
      });
      expect(extractCredentials(c)).toEqual({
        token: "sk-lw-customer-key",
        projectId: null,
      });
    });

    it("falls back to X-Auth-Token when Basic auth is undecodable base64", () => {
      const c = mockGetHeader({
        authorization: "Basic !@#$%^",
        "x-auth-token": "sk-lw-customer-key",
      });
      expect(extractCredentials(c)).toEqual({
        token: "sk-lw-customer-key",
        projectId: null,
      });
    });
  });

  describe("when using Bearer token", () => {
    it("extracts bearer token without project ID", () => {
      const c = mockGetHeader({ authorization: "Bearer pat-lw-lookup_secret" });
      const result = extractCredentials(c);

      expect(result).toEqual({
        token: "pat-lw-lookup_secret",
        projectId: null,
      });
    });

    it("extracts bearer token with X-Project-Id header", () => {
      const c = mockGetHeader({
        authorization: "Bearer pat-lw-lookup_secret",
        "x-project-id": "proj-123",
      });
      const result = extractCredentials(c);

      expect(result).toEqual({
        token: "pat-lw-lookup_secret",
        projectId: "proj-123",
      });
    });

    it("handles legacy sk-lw-* bearer tokens", () => {
      const c = mockGetHeader({ authorization: "Bearer sk-lw-abc123" });
      const result = extractCredentials(c);

      expect(result).toEqual({
        token: "sk-lw-abc123",
        projectId: null,
      });
    });

    it("falls back to X-Auth-Token when Bearer is empty", () => {
      const c = mockGetHeader({
        authorization: "Bearer ",
        "x-auth-token": "sk-lw-customer-key",
      });
      expect(extractCredentials(c)).toEqual({
        token: "sk-lw-customer-key",
        projectId: null,
      });
    });

    it("falls back to X-Auth-Token when Bearer is whitespace-only", () => {
      const c = mockGetHeader({
        authorization: "Bearer    ",
        "x-auth-token": "sk-lw-customer-key",
      });
      expect(extractCredentials(c)).toEqual({
        token: "sk-lw-customer-key",
        projectId: null,
      });
    });
  });

  describe("when using X-Auth-Token header", () => {
    it("extracts the token from X-Auth-Token", () => {
      const c = mockGetHeader({ "x-auth-token": "sk-lw-abc123" });
      const result = extractCredentials(c);

      expect(result).toEqual({
        token: "sk-lw-abc123",
        projectId: null,
      });
    });

    it("includes X-Project-Id when present", () => {
      const c = mockGetHeader({
        "x-auth-token": "pat-lw-lookup_secret",
        "x-project-id": "proj-456",
      });
      const result = extractCredentials(c);

      expect(result).toEqual({
        token: "pat-lw-lookup_secret",
        projectId: "proj-456",
      });
    });
  });

  describe("when no auth is provided", () => {
    it("returns null with no headers", () => {
      const c = mockGetHeader({});
      expect(extractCredentials(c)).toBeNull();
    });
  });

  describe("priority", () => {
    it("prioritizes Basic Auth over Bearer", () => {
      const encoded = Buffer.from("proj:basic-token").toString("base64");
      const c = mockGetHeader({
        authorization: `Basic ${encoded}`,
        "x-auth-token": "x-auth-value",
      });
      const result = extractCredentials(c);

      expect(result?.token).toBe("basic-token");
      expect(result?.projectId).toBe("proj");
    });
  });
});

describe("collectAuthDiagnostics", () => {
  it("captures the userAgent, traceparent, X-Forwarded-For and request path", () => {
    const c = mockHonoCtx({
      path: "/api/scenario-events",
      method: "POST",
      headers: {
        "user-agent": "python-httpx/0.28.1",
        traceparent: "00-1234abcd-5678efgh-01",
        "x-forwarded-for": "203.0.113.42, 10.0.0.1",
        "x-auth-token": "sk-lw-abc",
      },
    });
    expect(collectAuthDiagnostics(c)).toEqual({
      path: "/api/scenario-events",
      method: "POST",
      userAgent: "python-httpx/0.28.1",
      traceparent: "00-1234abcd-5678efgh-01",
      forwardedFor: "203.0.113.42, 10.0.0.1",
      hasEmptyAuthToken: false,
    });
  });

  it("falls back to X-Real-IP when X-Forwarded-For is absent", () => {
    const c = mockHonoCtx({ headers: { "x-real-ip": "192.0.2.5" } });
    expect(collectAuthDiagnostics(c).forwardedFor).toBe("192.0.2.5");
  });

  it("flags hasEmptyAuthToken when the header was sent but empty", () => {
    const c = mockHonoCtx({ headers: { "x-auth-token": "" } });
    const diag = collectAuthDiagnostics(c);
    expect(diag.hasEmptyAuthToken).toBe(true);
  });

  it("does NOT flag hasEmptyAuthToken when the header is absent entirely", () => {
    const c = mockHonoCtx({ headers: {} });
    const diag = collectAuthDiagnostics(c);
    expect(diag.hasEmptyAuthToken).toBe(false);
  });

  it("returns null for missing optional headers (no exceptions)", () => {
    const c = mockHonoCtx({ headers: {} });
    const diag = collectAuthDiagnostics(c);
    expect(diag.userAgent).toBeNull();
    expect(diag.traceparent).toBeNull();
    expect(diag.forwardedFor).toBeNull();
  });

  it("never includes a raw token value", () => {
    const c = mockHonoCtx({
      headers: {
        "x-auth-token": "sk-lw-SUPER-SECRET-VALUE",
        authorization: "Bearer pat-lw-ANOTHER-SECRET",
      },
    });
    const diag = collectAuthDiagnostics(c);
    const serialized = JSON.stringify(diag);
    expect(serialized).not.toContain("SUPER-SECRET-VALUE");
    expect(serialized).not.toContain("ANOTHER-SECRET");
  });
});
