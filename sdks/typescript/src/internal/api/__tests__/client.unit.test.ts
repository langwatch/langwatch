/**
 * Every request the CLI makes through `createLangWatchApiClient` carries
 * `x-langwatch-surface: cli`; a plain SDK embed sends nothing extra.
 * Feature: specs/observability/traffic-attribution.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// openapi-fetch keeps its header config private, so capture what the factory hands it.
const createClientCalls = vi.hoisted(() => [] as { headers?: Record<string, string> }[]);
vi.mock("openapi-fetch", () => ({
  default: (config: { headers?: Record<string, string> }) => {
    createClientCalls.push(config);
    return { use: () => undefined };
  },
}));

import {
  resetFallbackCredentialHolder,
  runWithCliCredentialHolder,
  runWithCredentialHolder,
} from "@/internal/credentialContext";
import { CLI_SURFACE_HEADER, CLI_SURFACE_VALUE } from "@/internal/surface";

import { createLangWatchApiClient } from "../client";

describe("createLangWatchApiClient", () => {
  afterEach(() => {
    resetFallbackCredentialHolder();
    vi.restoreAllMocks();
  });

  describe("when creating an API client", () => {
    describe("given a CLI request scope", () => {
      /** @scenario The CLI declares itself on every request */
      it("sends x-langwatch-surface: cli alongside the SDK identity headers", () => {
        createClientCalls.length = 0;

        runWithCliCredentialHolder({
          fn: () => {
            createLangWatchApiClient();
          },
        });

        expect(createClientCalls).toHaveLength(1);
        const config = createClientCalls[0];
        expect(config?.headers?.[CLI_SURFACE_HEADER]).toBe(CLI_SURFACE_VALUE);
        expect(config?.headers?.["x-langwatch-sdk-name"]).toBeDefined();
      });
    });

    describe("given no CLI request scope", () => {
      it("sends no surface header outside any holder scope", () => {
        createClientCalls.length = 0;

        createLangWatchApiClient();

        expect(createClientCalls).toHaveLength(1);
        const config = createClientCalls[0];
        expect(config?.headers?.[CLI_SURFACE_HEADER]).toBeUndefined();
      });

      it("sends no surface header for a plain SDK holder scope", () => {
        createClientCalls.length = 0;

        runWithCredentialHolder(() => {
          createLangWatchApiClient();
        });

        expect(createClientCalls).toHaveLength(1);
        const config = createClientCalls[0];
        expect(config?.headers?.[CLI_SURFACE_HEADER]).toBeUndefined();
      });
    });
  });
});
