import { describe, expect, it } from "vitest";
import { getDefaultModelState } from "../defaultModelState";

describe("getDefaultModelState", () => {
  describe("given providers is undefined and hasEnabledProviders is true", () => {
    it("returns ok:true (loading state — avoid flashing error banners)", () => {
      const result = getDefaultModelState({
        providers: undefined,
        hasEnabledProviders: true,
        defaultModel: "openai/gpt-5.2",
      });

      expect(result).toEqual({ ok: true });
    });
  });

  describe("given providers is undefined and hasEnabledProviders is false", () => {
    it("returns no-providers", () => {
      const result = getDefaultModelState({
        providers: undefined,
        hasEnabledProviders: false,
        defaultModel: "openai/gpt-5.2",
      });

      expect(result).toEqual({ ok: false, reason: "no-providers" });
    });
  });

  describe("given project.defaultModel is null", () => {
    it("returns no-default", () => {
      const result = getDefaultModelState({
        providers: { openai: { enabled: true } },
        hasEnabledProviders: true,
        defaultModel: null,
      });

      expect(result).toEqual({ ok: false, reason: "no-default" });
    });
  });

  describe("given project.defaultModel is openai/gpt-5.2 and openai provider is disabled", () => {
    it("returns stale-default", () => {
      const result = getDefaultModelState({
        providers: { openai: { enabled: false } },
        hasEnabledProviders: true,
        defaultModel: "openai/gpt-5.2",
      });

      expect(result).toEqual({ ok: false, reason: "stale-default" });
    });
  });

  describe("given project.defaultModel is anthropic/claude-sonnet-4-5 and anthropic provider is enabled", () => {
    it("returns ok:true", () => {
      const result = getDefaultModelState({
        providers: { anthropic: { enabled: true } },
        hasEnabledProviders: true,
        defaultModel: "anthropic/claude-sonnet-4-5",
      });

      expect(result).toEqual({ ok: true });
    });
  });

  describe("given project.defaultModel is azure/my-deploy and azure provider is enabled", () => {
    it("returns ok:true", () => {
      const result = getDefaultModelState({
        providers: { azure: { enabled: true } },
        hasEnabledProviders: true,
        defaultModel: "azure/my-deploy",
      });

      expect(result).toEqual({ ok: true });
    });
  });
});
