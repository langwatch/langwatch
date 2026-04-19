import { describe, it, expect } from "vitest";
import { extractCredentials } from "../auth-middleware";

function mockContext(headers: Record<string, string>) {
  return {
    req: {
      header: (name: string) => headers[name.toLowerCase()] ?? headers[name],
    },
  };
}

describe("extractCredentials", () => {
  describe("when using Basic Auth", () => {
    it("extracts projectId and token from base64-encoded header", () => {
      const encoded = Buffer.from("proj-123:pat-lw-lookup_secret").toString(
        "base64",
      );
      const c = mockContext({ authorization: `Basic ${encoded}` });
      const result = extractCredentials(c);

      expect(result).toEqual({
        token: "pat-lw-lookup_secret",
        projectId: "proj-123",
      });
    });

    it("handles colons in the token value", () => {
      const encoded = Buffer.from("proj:pat-lw-a_b:extra").toString("base64");
      const c = mockContext({ authorization: `Basic ${encoded}` });
      const result = extractCredentials(c);

      expect(result).toEqual({
        token: "pat-lw-a_b:extra",
        projectId: "proj",
      });
    });

    it("returns null for missing colon in decoded value", () => {
      const encoded = Buffer.from("no-colon-here").toString("base64");
      const c = mockContext({ authorization: `Basic ${encoded}` });
      expect(extractCredentials(c)).toBeNull();
    });

    it("returns null for empty projectId or token", () => {
      const encoded1 = Buffer.from(":token").toString("base64");
      const c1 = mockContext({ authorization: `Basic ${encoded1}` });
      expect(extractCredentials(c1)).toBeNull();

      const encoded2 = Buffer.from("proj:").toString("base64");
      const c2 = mockContext({ authorization: `Basic ${encoded2}` });
      expect(extractCredentials(c2)).toBeNull();
    });
  });

  describe("when using Bearer token", () => {
    it("extracts bearer token without project ID", () => {
      const c = mockContext({ authorization: "Bearer pat-lw-lookup_secret" });
      const result = extractCredentials(c);

      expect(result).toEqual({
        token: "pat-lw-lookup_secret",
        projectId: null,
      });
    });

    it("extracts bearer token with X-Project-Id header", () => {
      const c = mockContext({
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
      const c = mockContext({ authorization: "Bearer sk-lw-abc123" });
      const result = extractCredentials(c);

      expect(result).toEqual({
        token: "sk-lw-abc123",
        projectId: null,
      });
    });
  });

  describe("when using X-Auth-Token header", () => {
    it("extracts the token from X-Auth-Token", () => {
      const c = mockContext({ "x-auth-token": "sk-lw-abc123" });
      const result = extractCredentials(c);

      expect(result).toEqual({
        token: "sk-lw-abc123",
        projectId: null,
      });
    });

    it("includes X-Project-Id when present", () => {
      const c = mockContext({
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
      const c = mockContext({});
      expect(extractCredentials(c)).toBeNull();
    });
  });

  describe("priority", () => {
    it("prioritizes Basic Auth over Bearer", () => {
      const encoded = Buffer.from("proj:basic-token").toString("base64");
      const c = mockContext({
        authorization: `Basic ${encoded}`,
        "x-auth-token": "x-auth-value",
      });
      const result = extractCredentials(c);

      expect(result?.token).toBe("basic-token");
      expect(result?.projectId).toBe("proj");
    });
  });
});
