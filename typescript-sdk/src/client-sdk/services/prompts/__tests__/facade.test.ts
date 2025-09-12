import { describe, it, expect, beforeEach } from "vitest";
import { PromptsFacade } from "../facade";
import { Prompt } from "../prompt";
import { promptResponseFactory } from "@/factories/prompt-response.factory";
import { LocalPromptRepository } from "@/shared/prompts/local-prompt.repository";
import { type MockProxy, mockDeep } from "vitest-mock-extended";
import { NoOpLogger } from "@/logger";
import { type LangwatchApiClient } from "@/internal/api/client";
import { type ClientMethod } from "openapi-fetch";
import * as expectations from "@/__tests__/test-utils/expecations";

describe("PromptFacade", () => {
  const repository = new LocalPromptRepository();
  let mockApiClient: MockProxy<LangwatchApiClient & {
    GET: MockProxy<ClientMethod<any, "get", `${string}/${string}`>>;
  }>;
  let facade: PromptsFacade;

  const prompt = new Prompt(
    promptResponseFactory.build({
      model: "openai/gpt-4",
    }),
  );

  beforeEach(() => {
    mockApiClient = mockDeep<LangwatchApiClient>() as any;
    facade = new PromptsFacade({
      langwatchApiClient: mockApiClient,
      logger: new NoOpLogger(),
    });
    mockApiClient.GET.mockResolvedValue({
      data: prompt,
      response: {
        status: 200,
        statusText: "OK",
      } as any,
    });
  });

  describe("get", () => {
    describe("when local prompt is available", () => {
      it("returns local prompt when available", async () => {
        await repository.savePrompt("local-test", prompt);
        const result = await facade.get("local-test");

        expectations.toMatchPrompt(result, prompt);
      });
    });

    describe("when local prompt is not available", () => {
      it("attempts to fetch api prompt", async () => {
        const result = await facade.get("non-existent");
        expect(mockApiClient.GET).toHaveBeenCalledWith("/api/prompts/{id}", {
          params: {
            path: {
              id: "non-existent",
            },
          },
          query: {
            version: undefined,
          },
        });
        expect(result).toEqual(prompt);
      });

      describe("when api prompt is not available at all", () => {
        it("throws an error", async () => {
          mockApiClient.GET.mockRejectedValue({
            error: "Not Found",
          });

          await expect(facade.get("non-existent")).rejects.toThrow();
        });
      });
    });
  });
});
