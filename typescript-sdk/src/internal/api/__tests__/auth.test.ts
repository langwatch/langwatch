import { describe, it, expect, afterEach } from "vitest";
import { buildAuthHeaders, isPersonalAccessToken, isUserScopedApiKey } from "../auth";

describe("isUserScopedApiKey", () => {
  describe("when given an old pat-lw- token", () => {
    it("returns true", () => {
      expect(isUserScopedApiKey("pat-lw-abc_def")).toBe(true);
    });
  });

  describe("when given a new sk-lw- token with underscore", () => {
    it("returns true (user-scoped API key)", () => {
      expect(isUserScopedApiKey("sk-lw-abcdef1234567890_secretvalue")).toBe(true);
    });
  });

  describe("when given a legacy project key (no underscore)", () => {
    it("returns false", () => {
      expect(isUserScopedApiKey("sk-lw-legacykey123")).toBe(false);
    });
  });

  describe("when given an empty string", () => {
    it("returns false without throwing", () => {
      expect(isUserScopedApiKey("")).toBe(false);
    });
  });
});

describe("isPersonalAccessToken (deprecated alias)", () => {
  it("delegates to isUserScopedApiKey", () => {
    expect(isPersonalAccessToken("pat-lw-abc_def")).toBe(true);
    expect(isPersonalAccessToken("sk-lw-abc_def")).toBe(true);
    expect(isPersonalAccessToken("sk-lw-legacykey123")).toBe(false);
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

  describe("given a legacy sk-lw- project key (no underscore)", () => {
    it("emits bearer and x-auth-token for backwards compatibility", () => {
      const headers = buildAuthHeaders({ apiKey: "sk-lw-legacy" });
      expect(headers).toEqual({
        authorization: "Bearer sk-lw-legacy",
        "x-auth-token": "sk-lw-legacy",
      });
    });
  });

  describe("given an old pat-lw- token with projectId", () => {
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

  describe("given a new sk-lw- API key with projectId", () => {
    it("encodes projectId:token as Basic Auth", () => {
      const headers = buildAuthHeaders({
        apiKey: "sk-lw-lookupId1234567_secretSecretSecretSecret",
        projectId: "project_456",
      });
      const expected = Buffer.from(
        "project_456:sk-lw-lookupId1234567_secretSecretSecretSecret",
        "utf-8",
      ).toString("base64");
      expect(headers).toEqual({ authorization: `Basic ${expected}` });
    });
  });

  describe("given an API key with projectId from environment", () => {
    it("falls back to LANGWATCH_PROJECT_ID", () => {
      process.env.LANGWATCH_PROJECT_ID = "env_project";
      const headers = buildAuthHeaders({ apiKey: "pat-lw-envtok_secret" });
      const expected = Buffer.from(
        "env_project:pat-lw-envtok_secret",
        "utf-8",
      ).toString("base64");
      expect(headers).toEqual({ authorization: `Basic ${expected}` });
    });
  });

  describe("given an API key without any projectId", () => {
    it("falls back to bearer + x-auth-token", () => {
      delete process.env.LANGWATCH_PROJECT_ID;
      const headers = buildAuthHeaders({ apiKey: "pat-lw-nopid_secret" });
      expect(headers).toEqual({
        authorization: "Bearer pat-lw-nopid_secret",
        "x-auth-token": "pat-lw-nopid_secret",
      });
    });
  });
});
