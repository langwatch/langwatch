/**
 * The gate that reads a conversation's model and answers whether it may run
 * with Langy's permission checks skipped (ADR-129).
 *
 * Binds the @unit scenarios of
 * specs/settings/model-provider-skip-permissions.feature that are about the
 * GATE. The provider defaults are bound in
 * src/server/modelProviders/__tests__/langySkipPermissions.unit.test.ts.
 */
import { describe, expect, it, vi } from "vitest";

import {
  canModelSkipPermissions,
  type SkipPermissionsProviderRow,
} from "../langySkipPermissions";

const PROJECT_ID = "project-1";

function row(
  overrides: Partial<SkipPermissionsProviderRow> = {},
): SkipPermissionsProviderRow {
  return {
    id: "mp_anthropic",
    provider: "anthropic",
    routingHandle: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    langySkipPermissionsModels: null,
    ...overrides,
  };
}

function rowsSource(rows: SkipPermissionsProviderRow[]) {
  return { findAllAccessibleForProject: vi.fn().mockResolvedValue(rows) };
}

describe("Feature: the gate reads the conversation's model", () => {
  describe('given a conversation running on "anthropic/claude-fable-5-1"', () => {
    describe("when the gate is asked whether the model may skip", () => {
      /** @scenario The gate strips the provider prefix before matching */
      it("matches the bare model against the Anthropic list and answers yes", async () => {
        const providerRows = rowsSource([row()]);

        const decision = await canModelSkipPermissions({
          projectId: PROJECT_ID,
          model: "anthropic/claude-fable-5-1",
          providerRows,
        });

        expect(decision).toEqual({
          allowed: true,
          provider: "anthropic",
          modelId: "claude-fable-5-1",
        });
        expect(providerRows.findAllAccessibleForProject).toHaveBeenCalledWith(
          PROJECT_ID,
        );
      });
    });
  });

  describe("given a conversation running on a routing handle that points at an allowed model", () => {
    describe("when the gate is asked whether the model may skip", () => {
      /** @scenario A routing handle resolves to the provider and model behind it */
      it("answers yes", async () => {
        const providerRows = rowsSource([
          row({ id: "mp_eu", routingHandle: "eu" }),
        ]);

        const decision = await canModelSkipPermissions({
          projectId: PROJECT_ID,
          model: "eu/claude-opus-6",
          providerRows,
        });

        expect(decision).toEqual({
          allowed: true,
          provider: "anthropic",
          modelId: "claude-opus-6",
        });
      });

      it("answers no for a handle nothing in scope carries", async () => {
        const providerRows = rowsSource([row()]);

        const decision = await canModelSkipPermissions({
          projectId: PROJECT_ID,
          model: "eu/claude-opus-6",
          providerRows,
        });

        expect(decision.allowed).toBe(false);
        expect(decision.provider).toBe("");
      });
    });
  });

  describe("given the OpenAI provider with a custom list holding one pattern", () => {
    describe("when the gate is asked about a default model outside that pattern", () => {
      /** @scenario A custom list replaces the default, it does not extend it */
      it("answers no", async () => {
        const providerRows = rowsSource([
          row({
            id: "mp_openai",
            provider: "openai",
            langySkipPermissionsModels: ["^gpt-9$"],
          }),
        ]);

        const decision = await canModelSkipPermissions({
          projectId: PROJECT_ID,
          model: "openai/gpt-5.6-terra",
          providerRows,
        });

        expect(decision).toEqual({
          allowed: false,
          provider: "openai",
          modelId: "gpt-5.6-terra",
        });
      });

      it("still answers yes for a model the custom pattern names", async () => {
        const providerRows = rowsSource([
          row({
            id: "mp_openai",
            provider: "openai",
            langySkipPermissionsModels: ["^gpt-9$"],
          }),
        ]);

        const decision = await canModelSkipPermissions({
          projectId: PROJECT_ID,
          model: "openai/gpt-9",
          providerRows,
        });

        expect(decision.allowed).toBe(true);
      });
    });
  });

  describe("given a model named by the stored row id", () => {
    describe("when the gate is asked whether the model may skip", () => {
      it("reads that row's own list", async () => {
        const providerRows = rowsSource([
          row({
            id: "mp_openai",
            provider: "openai",
            langySkipPermissionsModels: ["^gpt-9$"],
          }),
          row({ id: "mp_other", provider: "openai" }),
        ]);

        const decision = await canModelSkipPermissions({
          projectId: PROJECT_ID,
          model: "mp_openai/gpt-5.6-terra",
          providerRows,
        });

        expect(decision.allowed).toBe(false);
        expect(decision.provider).toBe("openai");
      });
    });
  });

  describe("given several rows of the same provider carry a custom list", () => {
    describe("when the gate is asked about a model only the older row names", () => {
      it("answers from the oldest row, on every call", async () => {
        const providerRows = rowsSource([
          row({
            id: "mp_new",
            provider: "openai",
            createdAt: new Date("2026-05-01T00:00:00Z"),
            langySkipPermissionsModels: ["^gpt-8$"],
          }),
          row({
            id: "mp_old",
            provider: "openai",
            createdAt: new Date("2026-02-01T00:00:00Z"),
            langySkipPermissionsModels: ["^gpt-7$"],
          }),
        ]);

        const first = await canModelSkipPermissions({
          projectId: PROJECT_ID,
          model: "openai/gpt-7",
          providerRows,
        });
        const second = await canModelSkipPermissions({
          projectId: PROJECT_ID,
          model: "openai/gpt-8",
          providerRows,
        });

        expect(first.allowed).toBe(true);
        expect(second.allowed).toBe(false);
      });
    });
  });

  describe("given a model reference with no provider prefix", () => {
    describe("when the gate is asked whether the model may skip", () => {
      it("answers no, because nothing names the provider that vouches for it", async () => {
        const decision = await canModelSkipPermissions({
          projectId: PROJECT_ID,
          model: "gpt-6",
          providerRows: rowsSource([]),
        });

        expect(decision).toEqual({
          allowed: false,
          provider: "",
          modelId: "gpt-6",
        });
      });
    });
  });
});
