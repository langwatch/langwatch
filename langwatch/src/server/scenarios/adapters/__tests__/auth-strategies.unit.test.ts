/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import {
  applyAuthentication,
  AUTH_STRATEGIES,
  type AuthConfig,
} from "../auth-strategies";

describe("AUTH_STRATEGIES", () => {
  describe("none", () => {
    it("returns empty headers", () => {
      const result = AUTH_STRATEGIES.none({ type: "none" });
      expect(result).toEqual({});
    });
  });

  describe("bearer", () => {
    it("returns Authorization header with Bearer token", () => {
      const result = AUTH_STRATEGIES.bearer({
        type: "bearer",
        token: "my-secret-token",
      });
      expect(result).toEqual({
        Authorization: "Bearer my-secret-token",
      });
    });

    it("returns empty headers when type is not bearer", () => {
      const result = AUTH_STRATEGIES.bearer({ type: "none" });
      expect(result).toEqual({});
    });

    it("returns empty headers when token is missing", () => {
      const result = AUTH_STRATEGIES.bearer({ type: "bearer" });
      expect(result).toEqual({});
    });
  });

  describe("api_key", () => {
    it("returns custom header with API key", () => {
      const result = AUTH_STRATEGIES.api_key({
        type: "api_key",
        header: "X-API-Key",
        value: "my-api-key",
      });
      expect(result).toEqual({
        "X-API-Key": "my-api-key",
      });
    });

    it("returns empty headers when type is not api_key", () => {
      const result = AUTH_STRATEGIES.api_key({ type: "none" });
      expect(result).toEqual({});
    });

    it("returns empty headers when header is missing", () => {
      const result = AUTH_STRATEGIES.api_key({
        type: "api_key",
        value: "my-api-key",
      });
      expect(result).toEqual({});
    });

    it("returns empty headers when value is missing", () => {
      const result = AUTH_STRATEGIES.api_key({
        type: "api_key",
        header: "X-API-Key",
      });
      expect(result).toEqual({});
    });
  });

  describe("basic", () => {
    it("returns Authorization header with Base64 encoded credentials", () => {
      const result = AUTH_STRATEGIES.basic({
        type: "basic",
        username: "user",
        password: "pass",
      });

      const expectedCredentials = Buffer.from("user:pass").toString("base64");
      expect(result).toEqual({
        Authorization: `Basic ${expectedCredentials}`,
      });
    });

    it("handles empty password", () => {
      const result = AUTH_STRATEGIES.basic({
        type: "basic",
        username: "user",
      });

      const expectedCredentials = Buffer.from("user:").toString("base64");
      expect(result).toEqual({
        Authorization: `Basic ${expectedCredentials}`,
      });
    });

    it("returns empty headers when type is not basic", () => {
      const result = AUTH_STRATEGIES.basic({ type: "none" });
      expect(result).toEqual({});
    });

    it("returns empty headers when username is missing", () => {
      const result = AUTH_STRATEGIES.basic({
        type: "basic",
        password: "pass",
      });
      expect(result).toEqual({});
    });
  });
});

describe("applyAuthentication", () => {
  it("returns empty headers when auth is undefined", () => {
    const result = applyAuthentication(undefined);
    expect(result).toEqual({});
  });

  it("returns empty headers for none auth type", () => {
    const result = applyAuthentication({ type: "none" });
    expect(result).toEqual({});
  });

  it("applies bearer authentication", () => {
    const auth: AuthConfig = { type: "bearer", token: "token123" };
    const result = applyAuthentication(auth);
    expect(result).toEqual({
      Authorization: "Bearer token123",
    });
  });

  it("applies api_key authentication", () => {
    const auth: AuthConfig = {
      type: "api_key",
      header: "X-Custom-Key",
      value: "secret",
    };
    const result = applyAuthentication(auth);
    expect(result).toEqual({
      "X-Custom-Key": "secret",
    });
  });

  it("applies basic authentication", () => {
    const auth: AuthConfig = {
      type: "basic",
      username: "admin",
      password: "secret",
    };
    const result = applyAuthentication(auth);

    const expectedCredentials = Buffer.from("admin:secret").toString("base64");
    expect(result).toEqual({
      Authorization: `Basic ${expectedCredentials}`,
    });
  });

  it("returns empty headers for unknown auth type", () => {
    const result = applyAuthentication({
      type: "unknown" as AuthConfig["type"],
    });
    expect(result).toEqual({});
  });
});
