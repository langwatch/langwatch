/**
 * The platform tells CLI traffic apart from a plain SDK embed by the
 * `x-langwatch-surface: cli` header (packages/observability/src/request/
 * trafficAttribution.ts). Every request the CLI makes through
 * `createLangWatchApiClient` must carry it; a plain SDK embed must send
 * nothing extra, since it never scopes a surface.
 *
 * Feature: specs/observability/traffic-attribution.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// The real openapi-fetch client keeps its header config private, so capture
// what the factory hands it: the headers the transport would send are
// exactly what these tests need to observe.
const createClientCalls = vi.hoisted(
  () => [] as Array<{ headers?: Record<string, string> }>,
);
vi.mock("openapi-fetch", () => ({
  default: (config: { headers?: Record<string, string> }) => {
    createClientCalls.push(config);
    return { use: () => undefined };
  },
}));

import { createLangWatchApiClient } from "../client";
import {
  resetFallbackCredentialHolder,
  runWithCliCredentialHolder,
  runWithCredentialHolder,
} from "@/internal/credentialContext";
import { CLI_SURFACE_HEADER, CLI_SURFACE_VALUE } from "@/internal/surface";

describe("createLangWatchApiClient", () => {
  afterEach(() => {
    resetFallbackCredentialHolder();
    vi.restoreAllMocks();
  });

  describe("given a CLI request scope", () => {
    /** @scenario The CLI declares itself on every request */
    it("sends x-langwatch-surface: cli alongside the SDK identity headers", () => {
      createClientCalls.length = 0;

      runWithCliCredentialHolder(() => {
        createLangWatchApiClient();
      });

      const config = createClientCalls[0];
      expect(config?.headers?.[CLI_SURFACE_HEADER]).toBe(CLI_SURFACE_VALUE);
      expect(config?.headers?.["x-langwatch-sdk-name"]).toBeDefined();
    });
  });

  describe("given no CLI request scope", () => {
    it("sends no surface header outside any holder scope", () => {
      createClientCalls.length = 0;

      createLangWatchApiClient();

      const config = createClientCalls[0];
      expect(config?.headers?.[CLI_SURFACE_HEADER]).toBeUndefined();
    });

    it("sends no surface header for a plain SDK holder scope", () => {
      createClientCalls.length = 0;

      runWithCredentialHolder(() => {
        createLangWatchApiClient();
      });

      const config = createClientCalls[0];
      expect(config?.headers?.[CLI_SURFACE_HEADER]).toBeUndefined();
    });
  });
});
