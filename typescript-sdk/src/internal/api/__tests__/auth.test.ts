import { describe, it, expect, afterEach } from "vitest";
import { buildAuthHeaders, isPersonalAccessToken } from "../auth";

describe("isPersonalAccessToken", () => {
  describe("when given a PAT", () => {
    it("returns true for pat-lw- prefixed tokens", () => {
      expect(isPersonalAccessToken("pat-lw-abc_def")).toBe(true);
    });
  });

  describe("when given a legacy key", () => {
    it("returns false for sk-lw- prefixed tokens", () => {
      expect(isPersonalAccessToken("sk-lw-123")).toBe(false);
    });
  });

  describe("when given an empty string", () => {
    it("returns false without throwing", () => {
      expect(isPersonalAccessToken("")).toBe(false);
    });
  });
});

describe("buildAuthHeaders", () => {
  const ORIGINAL_ENV = process.env.LANGWATCH_PROJECT_ID;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.LANGWATCH_PROJECT_ID;
    } else {
      process.env.LANGWATCH_PROJECT_ID = ORIGINAL_ENV;
    }
  });

  describe("given no apiKey", () => {
    it("returns an empty header map", () => {
      expect(buildAuthHeaders({ apiKey: "" })).toEqual({});
    });
  });

  describe("given a legacy sk-lw- key", () => {
    it("emits bearer and x-auth-token for backwards compatibility", () => {
      const headers = buildAuthHeaders({ apiKey: "sk-lw-legacy" });
      expect(headers).toEqual({
        authorization: "Bearer sk-lw-legacy",
        "x-auth-token": "sk-lw-legacy",
      });
    });
  });

  describe("given a PAT with a projectId argument", () => {
    it("encodes projectId:token as Basic Auth", () => {
      const headers = buildAuthHeaders({
        apiKey: "pat-lw-abc_secret",
        projectId: "project_123",
      });
      const expected = Buffer.from(
        "project_123:pat-lw-abc_secret",
        "utf-8",
      ).toString("base64");
      expect(headers).toEqual({ authorization: `Basic ${expected}` });
    });
  });

  describe("given a PAT with projectId from environment", () => {
    it("falls back to LANGWATCH_PROJECT_ID", () => {
      process.env.LANGWATCH_PROJECT_ID = "env_project";
      const headers = buildAuthHeaders({ apiKey: "pat-lw-envtok" });
      const expected = Buffer.from(
        "env_project:pat-lw-envtok",
        "utf-8",
      ).toString("base64");
      expect(headers).toEqual({ authorization: `Basic ${expected}` });
    });
  });

  describe("given a PAT without any projectId", () => {
    it("falls back to bearer + x-auth-token so the server can reject cleanly", () => {
      delete process.env.LANGWATCH_PROJECT_ID;
      const headers = buildAuthHeaders({ apiKey: "pat-lw-nopid" });
      expect(headers).toEqual({
        authorization: "Bearer pat-lw-nopid",
        "x-auth-token": "pat-lw-nopid",
      });
    });
  });
});
