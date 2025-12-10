/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PromptsFacade } from "../prompts.facade";
import type { InternalConfig } from "@/client-sdk/types";
import { type PromptsApiService } from "../prompts-api.service";
import { mock, type MockProxy } from "vitest-mock-extended";
import { type LocalPromptsService } from "../local-prompts.service";
import { promptResponseFactory } from "../../../../../__tests__/factories/prompt.factory";
import { Prompt } from "../prompt";
import { localPromptConfigFactory } from "../../../../../__tests__/factories/local-prompt-config.factory";
import { FetchPolicy } from "../types";

/**
 * Tests for PromptsFacade.get
 * @see specs/prompts/fetch-policy.feature
 */
describe("Prompt Retrieval", () => {
  const testHandle = "test-prompt";
  const mockLocalPrompt = localPromptConfigFactory.build({ handle: testHandle });
  const mockServerPrompt = promptResponseFactory.build({ handle: testHandle });

  let facade: PromptsFacade;
  let localPromptsService: MockProxy<LocalPromptsService>;
  let promptsApiService: MockProxy<PromptsApiService>;

  beforeEach(() => {
    localPromptsService = mock<LocalPromptsService>();
    promptsApiService = mock<PromptsApiService>();
    facade = new PromptsFacade({
      localPromptsService,
      promptsApiService,
      langwatchApiClient: {} as InternalConfig["langwatchApiClient"],
      logger: {} as InternalConfig["logger"],
    });
    vi.clearAllMocks();
  });

  describe("Scenario: Default Behavior (Materialized First)", () => {
    it("returns local version and does NOT call API when prompt exists locally", async () => {
      // Given the prompt exists locally and on server
      localPromptsService.get.mockResolvedValue(mockLocalPrompt);

      // When I retrieve the prompt with no options
      const result = await facade.get(testHandle);

      // Then returns local version and does NOT call API
      expect(result).toEqual(new Prompt(mockLocalPrompt));
      expect(promptsApiService.get).not.toHaveBeenCalled();
    });
  });

  describe("Scenario: Materialized First - Fallback to Server", () => {
    it("returns server version when prompt does NOT exist locally", async () => {
      // Given prompt does NOT exist locally but exists on server
      localPromptsService.get.mockResolvedValue(null);
      promptsApiService.get.mockResolvedValue(mockServerPrompt);

      // When I retrieve with fetchPolicy MATERIALIZED_FIRST
      const result = await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.MATERIALIZED_FIRST,
      });

      // Then returns server version
      expect(localPromptsService.get).toHaveBeenCalledWith(testHandle);
      expect(promptsApiService.get).toHaveBeenCalledWith(testHandle, {
        fetchPolicy: FetchPolicy.MATERIALIZED_FIRST,
      });
      expect(result).toEqual(new Prompt(mockServerPrompt));
    });
  });

  describe("Scenario: Prompt Not Found Anywhere", () => {
    it("throws error when prompt does NOT exist locally or on server", async () => {
      // Given prompt does NOT exist locally or on server
      const ghostHandle = "ghost-prompt";
      const mockError = new Error("404: Prompt not found");
      localPromptsService.get.mockResolvedValue(null);
      promptsApiService.get.mockRejectedValue(mockError);

      // When I retrieve the prompt, Then throws error
      await expect(facade.get(ghostHandle)).rejects.toThrow(mockError);
      expect(localPromptsService.get).toHaveBeenCalledWith(ghostHandle);
      expect(promptsApiService.get).toHaveBeenCalledWith(ghostHandle, undefined);
    });
  });

  describe("Scenario: Always Fetch - Happy Path", () => {
    it("calls API first and returns server version", async () => {
      // Given prompt exists locally and on server
      promptsApiService.get.mockResolvedValue(mockServerPrompt);

      // When I retrieve with fetchPolicy ALWAYS_FETCH
      const result = await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.ALWAYS_FETCH,
      });

      // Then calls API first and returns server version
      expect(promptsApiService.get).toHaveBeenCalledWith(testHandle, {
        fetchPolicy: FetchPolicy.ALWAYS_FETCH,
      });
      expect(localPromptsService.get).not.toHaveBeenCalled();
      expect(result).toEqual(new Prompt(mockServerPrompt));
    });
  });

  describe("Scenario: Always Fetch - API Failure Fallback", () => {
    it("returns local version upon API failure", async () => {
      // Given API is down but prompt exists locally
      promptsApiService.get.mockRejectedValue(new Error("API error"));
      localPromptsService.get.mockResolvedValue(mockLocalPrompt);

      // When I retrieve with fetchPolicy ALWAYS_FETCH
      const result = await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.ALWAYS_FETCH,
      });

      // Then attempts API, upon failure returns local version
      expect(promptsApiService.get).toHaveBeenCalled();
      expect(localPromptsService.get).toHaveBeenCalledWith(testHandle);
      expect(result).toEqual(new Prompt(mockLocalPrompt));
    });
  });

  describe("Scenario: Materialized Only", () => {
    it("does NOT call API and throws error when prompt not found locally", async () => {
      // Given prompt does NOT exist locally
      localPromptsService.get.mockResolvedValue(null);

      // When I retrieve with fetchPolicy MATERIALIZED_ONLY
      // Then does NOT call API and throws error
      await expect(
        facade.get(testHandle, { fetchPolicy: FetchPolicy.MATERIALIZED_ONLY })
      ).rejects.toThrow();
      expect(promptsApiService.get).not.toHaveBeenCalled();
    });

    it("returns local prompt when it exists", async () => {
      // Given prompt exists locally
      localPromptsService.get.mockResolvedValue(mockLocalPrompt);

      // When I retrieve with fetchPolicy MATERIALIZED_ONLY
      const result = await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.MATERIALIZED_ONLY,
      });

      // Then returns local and does NOT call API
      expect(localPromptsService.get).toHaveBeenCalledWith(testHandle);
      expect(promptsApiService.get).not.toHaveBeenCalled();
      expect(result).toEqual(new Prompt(mockLocalPrompt));
    });
  });

  describe("Scenario: Cache TTL - First Fetch", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("fetches from API when cache is empty", async () => {
      // Given cache is empty
      promptsApiService.get.mockResolvedValue(mockServerPrompt);

      // When I retrieve with fetchPolicy CACHE_TTL and ttl 5 minutes
      const result = await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
      });

      // Then fetches from API
      expect(promptsApiService.get).toHaveBeenCalledWith(testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
      });
      expect(result).toEqual(new Prompt(mockServerPrompt));
    });
  });

  describe("Scenario: Cache TTL - Hit", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("returns cached version and does NOT call API within TTL", async () => {
      // Given prompt was fetched 4 minutes ago with TTL of 5 minutes
      promptsApiService.get.mockResolvedValue(mockServerPrompt);
      await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
      });
      vi.advanceTimersByTime(4 * 60 * 1000); // 4 minutes

      // When I retrieve the prompt
      const result = await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
      });

      // Then returns cached version and does NOT call API again
      expect(promptsApiService.get).toHaveBeenCalledTimes(1);
      expect(result).toEqual(new Prompt(mockServerPrompt));
    });
  });

  describe("Scenario: Cache TTL - Expiration", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("ignores cache and fetches from API after TTL expires", async () => {
      // Given prompt was fetched 6 minutes ago with TTL of 5 minutes
      promptsApiService.get.mockResolvedValue(mockServerPrompt);
      await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
      });
      vi.advanceTimersByTime(6 * 60 * 1000); // 6 minutes

      // When I retrieve the prompt
      await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
      });

      // Then ignores cache and fetches from API
      expect(promptsApiService.get).toHaveBeenCalledTimes(2);
    });
  });

  describe("Scenario: Cache TTL - API Failure Fallback", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("returns local version when API is down", async () => {
      // Given API is down and prompt exists locally
      promptsApiService.get.mockRejectedValue(new Error("API error"));
      localPromptsService.get.mockResolvedValue(mockLocalPrompt);

      // When I retrieve with fetchPolicy CACHE_TTL
      const result = await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
      });

      // Then returns local version
      expect(promptsApiService.get).toHaveBeenCalled();
      expect(localPromptsService.get).toHaveBeenCalledWith(testHandle);
      expect(result).toEqual(new Prompt(mockLocalPrompt));
    });
  });
});
