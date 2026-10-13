import { describe, expect, it, vi } from "vitest";

import type { LangwatchApiClient } from "@/internal/api/client";
import { isLangWatchHandledError } from "@/internal/api/errors";

import { GraphsApiError, GraphsApiService } from "../graphs-api.service";

const serviceWith = (error: unknown) =>
  new GraphsApiService({
    langwatchApiClient: {
      POST: vi.fn(async () => ({ error })),
    } as unknown as LangwatchApiClient,
  });

const rejectionOf = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error,
  );

describe("GraphsApiService", () => {
  describe("when the platform names the refusal", () => {
    it("throws the handled error with its code, never a network error", async () => {
      const thrown = await rejectionOf(
        serviceWith({
          error: {
            type: "forbidden",
            code: "custom_graph_writes_disabled_for_playground",
            message: "Creating or editing dashboard graphs is turned off.",
          },
        }).create({} as never),
      );

      expect(isLangWatchHandledError(thrown)).toBe(true);
      expect(thrown).toMatchObject({
        code: "custom_graph_writes_disabled_for_playground",
      });
    });
  });

  describe("when the failure body is not the platform's shape", () => {
    it("throws the family's own error, as before", async () => {
      const thrown = await rejectionOf(serviceWith("<html>bad gateway</html>").create({} as never));

      expect(isLangWatchHandledError(thrown)).toBe(false);
      expect(thrown).toBeInstanceOf(GraphsApiError);
    });
  });
});
