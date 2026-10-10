import { describe, it, expect, beforeEach, afterEach, type Mock, vi } from "vitest";
import { mock, type MockProxy } from "vitest-mock-extended";

import type { InternalConfig } from "@/client-sdk/types";

import { localPromptConfigFactory } from "../../../../../__tests__/factories/local-prompt-config.factory";
import { promptResponseFactory } from "../../../../../__tests__/factories/prompt.factory";
import { PromptsError } from "../errors";
import { type LocalPromptsService } from "../local-prompts.service";
import { Prompt } from "../prompt";
import { type PromptsApiService } from "../prompts-api.service";
import { PromptsFacade } from "../prompts.facade";
import { FetchPolicy } from "../types";

/**
 * Tests for PromptsFacade.get
 * @see sdks/python/specs/prompts/fetch-policy.feature
 */
describe("Prompt Retrieval", () => {
  const testHandle = "test-prompt";
  const mockLocalPrompt = localPromptConfigFactory.build({ handle: testHandle });
  const mockServerPrompt = promptResponseFactory.build({ handle: testHandle });

  let facade: PromptsFacade;
  let localPromptsService: MockProxy<LocalPromptsService>;
  let promptsApiService: MockProxy<PromptsApiService>;
  let localGet: Mock;

  beforeEach(() => {
    localGet = vi.fn();
    localPromptsService = mock<LocalPromptsService>({ get: localGet });
    promptsApiService = mock<PromptsApiService>();
    facade = new PromptsFacade({
      localPromptsService,
      promptsApiService,
      langwatchApiClient: {} as InternalConfig["langwatchApiClient"],
      logger: {} as InternalConfig["logger"],
    });
    vi.clearAllMocks();
  });

  describe("when using default behaviour (materialized first)", () => {
    /** @scenario Fetch without tag returns latest */
    it("returns local version and does NOT call API when prompt exists locally", async () => {
      // Given the prompt exists locally and on server
      localGet.mockResolvedValue(mockLocalPrompt);

      // When I retrieve the prompt with no options
      const result = await facade.get(testHandle);

      // Then returns local version and does NOT call API
      expect(result).toEqual(new Prompt(mockLocalPrompt));
      expect(promptsApiService.get).not.toHaveBeenCalled();
    });
  });

  describe("when materialized-first falls back to the server", () => {
    it("returns server version when prompt does NOT exist locally", async () => {
      // Given prompt does NOT exist locally but exists on server
      localGet.mockResolvedValue(null);
      promptsApiService.get.mockResolvedValue(mockServerPrompt);

      // When I retrieve with fetchPolicy MATERIALIZED_FIRST
      const result = await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.MATERIALIZED_FIRST,
      });

      // Then returns server version
      expect(localGet).toHaveBeenCalledWith(testHandle);
      expect(promptsApiService.get).toHaveBeenCalledWith(testHandle, {
        fetchPolicy: FetchPolicy.MATERIALIZED_FIRST,
      });
      expect(result).toEqual(new Prompt(mockServerPrompt));
    });
  });

  describe("when the prompt is not found anywhere", () => {
    /** @scenario "Prompt not found anywhere throws error" */
    it("throws error when prompt does NOT exist locally or on server", async () => {
      // Given prompt does NOT exist locally or on server
      const ghostHandle = "ghost-prompt";
      const mockError = new Error("404: Prompt not found");
      localGet.mockResolvedValue(null);
      promptsApiService.get.mockRejectedValue(mockError);

      // When I retrieve the prompt, Then throws error
      await expect(facade.get(ghostHandle)).rejects.toThrow(mockError);
      expect(localGet).toHaveBeenCalledWith(ghostHandle);
      expect(promptsApiService.get).toHaveBeenCalledWith(ghostHandle, undefined);
    });
  });

  describe("when always-fetch succeeds", () => {
    /** @scenario "ALWAYS_FETCH returns server prompt" */
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
      expect(localGet).not.toHaveBeenCalled();
      expect(result).toEqual(new Prompt(mockServerPrompt));
    });
  });

  describe("when always-fetch falls back after an API failure", () => {
    /** @scenario "ALWAYS_FETCH falls back to local when API fails" */
    it("returns local version upon API failure", async () => {
      // Given API is down but prompt exists locally
      promptsApiService.get.mockRejectedValue(new Error("API error"));
      localGet.mockResolvedValue(mockLocalPrompt);

      // When I retrieve with fetchPolicy ALWAYS_FETCH
      const result = await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.ALWAYS_FETCH,
      });

      // Then attempts API, upon failure returns local version
      expect(promptsApiService.get).toHaveBeenCalled();
      expect(localGet).toHaveBeenCalledWith(testHandle);
      expect(result).toEqual(new Prompt(mockLocalPrompt));
    });
  });

  describe("when using materialized-only fetch policy", () => {
    /** @scenario "MATERIALIZED_ONLY throws when local file not found" */
    it("does NOT call API and throws error when prompt not found locally", async () => {
      // Given prompt does NOT exist locally
      localGet.mockResolvedValue(null);

      // When I retrieve with fetchPolicy MATERIALIZED_ONLY
      // Then does NOT call API and throws error
      await expect(
        facade.get(testHandle, { fetchPolicy: FetchPolicy.MATERIALIZED_ONLY }),
      ).rejects.toThrow(PromptsError);
      expect(promptsApiService.get).not.toHaveBeenCalled();
    });

    /** @scenario "MATERIALIZED_ONLY returns local prompt without API call" */
    it("returns local prompt when it exists", async () => {
      // Given prompt exists locally
      localGet.mockResolvedValue(mockLocalPrompt);

      // When I retrieve with fetchPolicy MATERIALIZED_ONLY
      const result = await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.MATERIALIZED_ONLY,
      });

      // Then returns local and does NOT call API
      expect(localGet).toHaveBeenCalledWith(testHandle);
      expect(promptsApiService.get).not.toHaveBeenCalled();
      expect(result).toEqual(new Prompt(mockLocalPrompt));
    });
  });

  describe("when the cache TTL policy performs its first fetch", () => {
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

  describe("when the cache TTL policy hits the cache", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    /** @scenario "CACHE_TTL returns cached version before expiration" */
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

  describe("when the cache TTL expires", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    /** @scenario "CACHE_TTL refetches after expiration" */
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

  describe("when the cache TTL policy falls back after an API failure", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    /** @scenario "CACHE_TTL falls back to local when API fails" */
    it("returns local version when API is down", async () => {
      // Given API is down and prompt exists locally
      promptsApiService.get.mockRejectedValue(new Error("API error"));
      localGet.mockResolvedValue(mockLocalPrompt);

      // When I retrieve with fetchPolicy CACHE_TTL
      const result = await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
      });

      // Then returns local version
      expect(promptsApiService.get).toHaveBeenCalled();
      expect(localGet).toHaveBeenCalledWith(testHandle);
      expect(result).toEqual(new Prompt(mockLocalPrompt));
    });
  });

  describe("when using shorthand syntax passthrough (thin client)", () => {
    describe("when fetching with colon-separated shorthand", () => {
      /** @scenario Shorthand syntax passes through to API without client-side parsing */
      it("passes the full string to the API without parsing", async () => {
        const productionPrompt = promptResponseFactory.build({
          handle: testHandle,
          version: 3,
        });
        localGet.mockResolvedValue(null);
        promptsApiService.get.mockResolvedValue(productionPrompt);

        const result = await facade.get(`${testHandle}:production`);

        expect(promptsApiService.get).toHaveBeenCalledWith(`${testHandle}:production`, undefined);
        expect(result).toEqual(new Prompt(productionPrompt));
      });
    });
  });

  describe("when the cache TTL policy isolates by version", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    /** @scenario "CACHE_TTL caches versions independently" */
    it("caches versions independently (different versions do not collide)", async () => {
      // Given "my-prompt" version "1" was cached
      const v1Prompt = promptResponseFactory.build({ handle: testHandle, version: 1 });
      const v2Prompt = promptResponseFactory.build({ handle: testHandle, version: 2 });
      promptsApiService.get.mockResolvedValueOnce(v1Prompt);
      promptsApiService.get.mockResolvedValueOnce(v2Prompt);

      await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
        version: "1",
      });

      // When I request "my-prompt" version "2"
      await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
        version: "2",
      });

      // Then it's a cache miss (API called twice)
      expect(promptsApiService.get).toHaveBeenCalledTimes(2);
      expect(promptsApiService.get).toHaveBeenNthCalledWith(1, testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
        version: "1",
      });
      expect(promptsApiService.get).toHaveBeenNthCalledWith(2, testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
        version: "2",
      });
    });
  });

  describe("when fetching by tag", () => {
    describe("when fetching with a tag using MATERIALIZED_FIRST", () => {
      /** @scenario Fetch prompt by tag via options */
      it("passes tag through to API service when no local prompt exists", async () => {
        const productionPrompt = promptResponseFactory.build({
          handle: testHandle,
          version: 3,
        });
        localGet.mockResolvedValue(null);
        promptsApiService.get.mockResolvedValue(productionPrompt);

        const result = await facade.get(testHandle, {
          tag: "production",
          fetchPolicy: FetchPolicy.MATERIALIZED_FIRST,
        });

        expect(promptsApiService.get).toHaveBeenCalledWith(testHandle, {
          tag: "production",
          fetchPolicy: FetchPolicy.MATERIALIZED_FIRST,
        });
        expect(result).toEqual(new Prompt(productionPrompt));
      });
    });

    describe("when fetching with a tag using ALWAYS_FETCH", () => {
      it("passes tag through to API service", async () => {
        const stagingPrompt = promptResponseFactory.build({
          handle: testHandle,
          version: 4,
        });
        promptsApiService.get.mockResolvedValue(stagingPrompt);

        const result = await facade.get(testHandle, {
          tag: "staging",
          fetchPolicy: FetchPolicy.ALWAYS_FETCH,
        });

        expect(promptsApiService.get).toHaveBeenCalledWith(testHandle, {
          tag: "staging",
          fetchPolicy: FetchPolicy.ALWAYS_FETCH,
        });
        expect(result).toEqual(new Prompt(stagingPrompt));
      });
    });
  });

  describe("when the tag is invalid", () => {
    describe("when the API returns an error for an invalid tag", () => {
      /** @scenario Unassigned tag returns error */
      it("throws an error when API rejects and no local fallback exists", async () => {
        promptsApiService.get.mockRejectedValue(
          new Error("Invalid tag: must be 'production' or 'staging'"),
        );
        localGet.mockResolvedValue(null);

        await expect(
          facade.get(testHandle, {
            tag: "production",
            fetchPolicy: FetchPolicy.ALWAYS_FETCH,
          }),
        ).rejects.toThrow(`Prompt "${testHandle}" not found locally or on server`);
      });
    });
  });

  describe("when the cache key is isolated by tag", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    /** @scenario Tag is included in cache key */
    it("returns cached prompt on second call with same tag within TTL", async () => {
      const productionPrompt = promptResponseFactory.build({
        handle: testHandle,
        version: 3,
      });
      promptsApiService.get.mockResolvedValue(productionPrompt);

      await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
        tag: "production",
      });

      // Second call within TTL should hit cache (API called only once)
      await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
        tag: "production",
      });

      expect(promptsApiService.get).toHaveBeenCalledTimes(1);
    });

    it("returns cached untagged prompt on second call within TTL", async () => {
      const latestPrompt = promptResponseFactory.build({
        handle: testHandle,
        version: 4,
      });
      promptsApiService.get.mockResolvedValue(latestPrompt);

      await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
      });

      // Second call without tag within TTL should hit cache (API called only once)
      await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
      });

      expect(promptsApiService.get).toHaveBeenCalledTimes(1);
    });

    /** @scenario Different tags produce different cache entries */
    it("returns different prompts for different tags with CACHE_TTL", async () => {
      const productionPrompt = promptResponseFactory.build({
        handle: testHandle,
        version: 3,
      });
      const stagingPrompt = promptResponseFactory.build({
        handle: testHandle,
        version: 4,
      });
      promptsApiService.get.mockResolvedValueOnce(productionPrompt);
      promptsApiService.get.mockResolvedValueOnce(stagingPrompt);

      const productionResult = await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
        tag: "production",
      });

      const stagingResult = await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
        tag: "staging",
      });

      expect(promptsApiService.get).toHaveBeenCalledTimes(2);
      expect(productionResult).toEqual(new Prompt(productionPrompt));
      expect(stagingResult).toEqual(new Prompt(stagingPrompt));
    });

    it("returns latest version for untagged request even when tagged version is cached", async () => {
      const productionPrompt = promptResponseFactory.build({
        handle: testHandle,
        version: 3,
      });
      const latestPrompt = promptResponseFactory.build({
        handle: testHandle,
        version: 4,
      });
      promptsApiService.get.mockResolvedValueOnce(productionPrompt);
      promptsApiService.get.mockResolvedValueOnce(latestPrompt);

      const productionResult = await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
        tag: "production",
      });

      const latestResult = await facade.get(testHandle, {
        fetchPolicy: FetchPolicy.CACHE_TTL,
        cacheTtlMinutes: 5,
      });

      expect(promptsApiService.get).toHaveBeenCalledTimes(2);
      expect(productionResult).toEqual(new Prompt(productionPrompt));
      expect(latestResult).toEqual(new Prompt(latestPrompt));
    });
  });
});

describe("PromptsFacade.tags.rename", () => {
  let facade: PromptsFacade;
  let promptsApiService: MockProxy<PromptsApiService>;
  let localPromptsService: MockProxy<LocalPromptsService>;
  let renameTag: Mock;

  beforeEach(() => {
    renameTag = vi.fn();
    localPromptsService = mock<LocalPromptsService>();
    promptsApiService = mock<PromptsApiService>({ renameTag });
    facade = new PromptsFacade({
      localPromptsService,
      promptsApiService,
      langwatchApiClient: {} as InternalConfig["langwatchApiClient"],
      logger: {} as InternalConfig["logger"],
    });
    vi.clearAllMocks();
  });

  describe("when renaming a tag", () => {
    /** @scenario Facade tags.rename delegates to renameTag */
    it("delegates to renameTag with old and new names", async () => {
      renameTag.mockResolvedValue(undefined);

      await facade.tags.rename("old-name", "new-name");

      expect(renameTag).toHaveBeenCalledWith({
        tag: "old-name",
        name: "new-name",
      });
    });
  });
});
