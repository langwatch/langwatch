/**
 * One rule decides which Google door a Gemini credential opens, and both
 * the execution path (prepareLitellmParams) and the read path that tells
 * the picker what a row can serve read it from here. A second copy of the
 * rule is how the picker and the request end up disagreeing.
 *
 * Covers @unit scenarios from
 * specs/model-providers/google-agent-platform.feature.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  geminiAgentPlatformPair,
  rowCannotServeEmbeddings,
} from "../geminiDoor";

const envKeys = ["GEMINI_PROJECT", "GEMINI_LOCATION"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of envKeys) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

describe("geminiAgentPlatformPair", () => {
  describe("given a stored credential", () => {
    it("names the Agent Platform door when it carries both fields", () => {
      expect(
        geminiAgentPlatformPair({
          GEMINI_API_KEY: "AQ.key",
          GEMINI_PROJECT: "acme-123",
          GEMINI_LOCATION: "global",
        }),
      ).toEqual({ project: "acme-123", location: "global" });
    });

    it("names no door on half a pair", () => {
      expect(
        geminiAgentPlatformPair({
          GEMINI_API_KEY: "AQ.key",
          GEMINI_PROJECT: "acme-123",
        }),
      ).toBeNull();
    });

    it("names no door on whitespace-only values", () => {
      expect(
        geminiAgentPlatformPair({
          GEMINI_API_KEY: "AQ.key",
          GEMINI_PROJECT: "  ",
          GEMINI_LOCATION: "global",
        }),
      ).toBeNull();
    });

    /**
     * The credential travels as a unit. Mixing sources would let an
     * operator exporting the pair silently reroute every stored AI Studio
     * key through a door it cannot open.
     */
    it("ignores the server env when the key is stored", () => {
      process.env.GEMINI_PROJECT = "operator-project";
      process.env.GEMINI_LOCATION = "us-central1";

      expect(geminiAgentPlatformPair({ GEMINI_API_KEY: "AQ.key" })).toBeNull();
    });
  });

  describe("given an env-fed credential (no stored key)", () => {
    it("takes the pair from the server env", () => {
      process.env.GEMINI_PROJECT = "operator-project";
      process.env.GEMINI_LOCATION = "us-central1";

      expect(geminiAgentPlatformPair(null)).toEqual({
        project: "operator-project",
        location: "us-central1",
      });
    });

    it("names no door when the env carries neither", () => {
      expect(geminiAgentPlatformPair(null)).toBeNull();
    });
  });
});

describe("rowCannotServeEmbeddings", () => {
  /** @scenario Embedding models are not offered through a door that cannot serve them */
  it("is true only for a Gemini row on the Agent Platform door", () => {
    const agentPlatform = {
      GEMINI_API_KEY: "AQ.key",
      GEMINI_PROJECT: "acme-123",
      GEMINI_LOCATION: "global",
    };

    expect(
      rowCannotServeEmbeddings({
        provider: "gemini",
        customKeys: agentPlatform,
      }),
    ).toBe(true);
    expect(
      rowCannotServeEmbeddings({
        provider: "gemini",
        customKeys: { GEMINI_API_KEY: "AIza.key" },
      }),
    ).toBe(false);
    // The pair means nothing outside Gemini — Vertex carries its own.
    expect(
      rowCannotServeEmbeddings({
        provider: "vertex_ai",
        customKeys: agentPlatform,
      }),
    ).toBe(false);
  });
});
