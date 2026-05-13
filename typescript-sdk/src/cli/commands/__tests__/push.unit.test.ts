import * as fs from "fs";
import * as yaml from "js-yaml";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PromptsConfig, PromptsLock, SyncResult } from "../../types";
import type { PromptsApiService } from "@/client-sdk/services/prompts";

// Mock FileManager before importing push
vi.mock("../../utils/fileManager", () => ({
  FileManager: {
    loadLocalPrompt: vi.fn(),
    getLocalPromptFiles: vi.fn().mockReturnValue([]),
    promptNameFromPath: vi.fn(),
  },
}));

// Mock ora spinner
vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn(),
    text: "",
  }),
}));

import { pushPrompts } from "../push";
import { FileManager } from "../../utils/fileManager";

describe("pushPrompts", () => {
  let mockSync: ReturnType<typeof vi.fn>;
  let mockUpdate: ReturnType<typeof vi.fn>;
  let promptsApiService: PromptsApiService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSync = vi.fn();
    mockUpdate = vi.fn();
    promptsApiService = {
      sync: mockSync,
      update: mockUpdate,
    } as unknown as PromptsApiService;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("when local config has response_format with schema", () => {
    it("sends outputs with json_schema type (response_format derived server-side)", async () => {
      const responseSchema = {
        type: "object",
        properties: {
          requirement_to_column_mapping: {
            type: "array",
            items: {
              type: "object",
              properties: {
                requirement_property_name: { type: "string" },
                column_id: { type: "string" },
              },
              required: ["requirement_property_name", "column_id"],
              additionalProperties: false,
            },
          },
        },
        required: ["requirement_to_column_mapping"],
        additionalProperties: false,
      };

      vi.mocked(FileManager.loadLocalPrompt).mockReturnValue({
        model: "openai/gpt-4o",
        modelParameters: { temperature: 0 },
        messages: [
          { role: "system", content: "You are a mapping assistant." },
          { role: "user", content: "Map these requirements." },
        ],
        response_format: {
          name: "requirement_to_column_mapping",
          schema: responseSchema,
        },
      } as any);

      mockSync.mockResolvedValue({
        action: "created",
        prompt: { version: 1, versionId: "v1" },
      });

      const config: PromptsConfig = {
        prompts: { "test-prompt": "file:prompts/test.prompt.yaml" },
      };
      const lock: PromptsLock = { lockfileVersion: 1, prompts: {} };
      const result: SyncResult = {
        fetched: [],
        pushed: [],
        unchanged: [],
        cleaned: [],
        errors: [],
      };

      await pushPrompts({ config, lock, promptsApiService, result });

      expect(mockSync).toHaveBeenCalledTimes(1);
      const syncCall = mockSync.mock.calls[0]![0];

      // Verify outputs includes json_schema type with the full schema
      expect(syncCall.configData.outputs).toEqual([
        {
          identifier: "requirement_to_column_mapping",
          type: "json_schema",
          json_schema: responseSchema,
        },
      ]);

      // response_format should NOT be sent (server derives it from outputs)
      expect(syncCall.configData.response_format).toBeUndefined();
    });

    it("uses response_format name as output identifier", async () => {
      vi.mocked(FileManager.loadLocalPrompt).mockReturnValue({
        model: "openai/gpt-4o",
        messages: [{ role: "system", content: "test" }],
        response_format: {
          name: "custom_output_name",
          schema: { type: "object", properties: {} },
        },
      } as any);

      mockSync.mockResolvedValue({
        action: "created",
        prompt: { version: 1, versionId: "v1" },
      });

      const config: PromptsConfig = {
        prompts: { "my-prompt": "file:prompts/my.prompt.yaml" },
      };
      const lock: PromptsLock = { lockfileVersion: 1, prompts: {} };
      const result: SyncResult = {
        fetched: [],
        pushed: [],
        unchanged: [],
        cleaned: [],
        errors: [],
      };

      await pushPrompts({ config, lock, promptsApiService, result });

      const syncCall = mockSync.mock.calls[0]![0];
      expect(syncCall.configData.outputs[0].identifier).toBe(
        "custom_output_name"
      );
    });

    it("defaults to 'output' when response_format has no name", async () => {
      vi.mocked(FileManager.loadLocalPrompt).mockReturnValue({
        model: "openai/gpt-4o",
        messages: [{ role: "system", content: "test" }],
        response_format: {
          // A rich (non-flat) schema stays a single json_schema output, so the
          // identifier-fallback path is what's under test here. Flat object
          // schemas intentionally expand into flat fields instead (see the
          // dedicated round-trip suite).
          schema: {
            type: "object",
            properties: {
              value: { type: "string", enum: ["a", "b"] },
            },
          },
        },
      } as any);

      mockSync.mockResolvedValue({
        action: "created",
        prompt: { version: 1, versionId: "v1" },
      });

      const config: PromptsConfig = {
        prompts: { "unnamed-prompt": "file:prompts/unnamed.prompt.yaml" },
      };
      const lock: PromptsLock = { lockfileVersion: 1, prompts: {} };
      const result: SyncResult = {
        fetched: [],
        pushed: [],
        unchanged: [],
        cleaned: [],
        errors: [],
      };

      await pushPrompts({ config, lock, promptsApiService, result });

      const syncCall = mockSync.mock.calls[0]![0];
      expect(syncCall.configData.outputs[0].identifier).toBe("output");
    });
  });

  describe("when local config has no response_format", () => {
    it("sends default str output", async () => {
      vi.mocked(FileManager.loadLocalPrompt).mockReturnValue({
        model: "openai/gpt-4o",
        modelParameters: { temperature: 0.7 },
        messages: [
          { role: "system", content: "You are a helpful assistant." },
        ],
      } as any);

      mockSync.mockResolvedValue({
        action: "created",
        prompt: { version: 1, versionId: "v1" },
      });

      const config: PromptsConfig = {
        prompts: { "simple-prompt": "file:prompts/simple.prompt.yaml" },
      };
      const lock: PromptsLock = { lockfileVersion: 1, prompts: {} };
      const result: SyncResult = {
        fetched: [],
        pushed: [],
        unchanged: [],
        cleaned: [],
        errors: [],
      };

      await pushPrompts({ config, lock, promptsApiService, result });

      const syncCall = mockSync.mock.calls[0]![0];

      // Default output type should be str
      expect(syncCall.configData.outputs).toEqual([
        { identifier: "output", type: "str" },
      ]);

      // No response_format should be set
      expect(syncCall.configData.response_format).toBeUndefined();
    });
  });

  describe("when response_format has no schema", () => {
    it("falls back to default str output", async () => {
      vi.mocked(FileManager.loadLocalPrompt).mockReturnValue({
        model: "openai/gpt-4o",
        messages: [{ role: "system", content: "test" }],
        response_format: { name: "my_format" },
      } as any);

      mockSync.mockResolvedValue({
        action: "created",
        prompt: { version: 1, versionId: "v1" },
      });

      const config: PromptsConfig = {
        prompts: { "no-schema": "file:prompts/no-schema.prompt.yaml" },
      };
      const lock: PromptsLock = { lockfileVersion: 1, prompts: {} };
      const result: SyncResult = {
        fetched: [],
        pushed: [],
        unchanged: [],
        cleaned: [],
        errors: [],
      };

      await pushPrompts({ config, lock, promptsApiService, result });

      const syncCall = mockSync.mock.calls[0]![0];

      // Without schema, outputs fall back to default str
      expect(syncCall.configData.outputs).toEqual([
        { identifier: "output", type: "str" },
      ]);

      // No response_format sent
      expect(syncCall.configData.response_format).toBeUndefined();
    });
  });

  describe("when local config has no modelParameters temperature", () => {
    /** @scenario Pushing a prompt with no temperature sends no temperature */
    it("sends no temperature, so removing it from YAML clears it", async () => {
      vi.mocked(FileManager.loadLocalPrompt).mockReturnValue({
        model: "openai/gpt-5.5",
        messages: [{ role: "system", content: "You are a helpful assistant." }],
      } as any);

      mockSync.mockResolvedValue({
        action: "created",
        prompt: { version: 1, versionId: "v1" },
      });

      const config: PromptsConfig = {
        prompts: { "no-temp": "file:prompts/no-temp.prompt.yaml" },
      };
      const lock: PromptsLock = { lockfileVersion: 1, prompts: {} };
      const result: SyncResult = {
        fetched: [],
        pushed: [],
        unchanged: [],
        cleaned: [],
        errors: [],
      };

      await pushPrompts({ config, lock, promptsApiService, result });

      const syncCall = mockSync.mock.calls[0]![0];
      expect(syncCall.configData.temperature).toBeUndefined();
    });
  });

  describe("when local config has runtime config", () => {
    it("sends config to prompt sync", async () => {
      /**
       * @scenario TypeScript local prompt files preserve runtime config
       */
      vi.mocked(FileManager.loadLocalPrompt).mockReturnValue({
        model: "openai/gpt-4o",
        messages: [{ role: "system", content: "test" }],
        config: { cli: true },
      } as any);

      mockSync.mockResolvedValue({
        action: "created",
        prompt: { version: 1, versionId: "v1" },
      });

      const config: PromptsConfig = {
        prompts: { "runtime-config": "file:prompts/runtime.prompt.yaml" },
      };
      const lock: PromptsLock = { lockfileVersion: 1, prompts: {} };
      const result: SyncResult = {
        fetched: [],
        pushed: [],
        unchanged: [],
        cleaned: [],
        errors: [],
      };

      await pushPrompts({ config, lock, promptsApiService, result });

      expect(mockSync).toHaveBeenCalledWith(
        expect.objectContaining({
          config: { cli: true },
        }),
      );
    });

    it.skip("writes remote config when resolving a conflict with remote", async () => {
      /**
       * @scenario Syncing a local prompt detects runtime config conflicts
       */
      vi.mocked(FileManager.loadLocalPrompt).mockReturnValue({
        model: "openai/gpt-4o",
        messages: [{ role: "system", content: "local" }],
        config: { local: true },
      } as any);

      mockSync.mockResolvedValue({
        action: "conflict",
        conflictInfo: {
          localVersion: 1,
          remoteVersion: 1,
          differences: ["config changed"],
          remoteConfigData: {
            model: "openai/gpt-4o",
            prompt: "remote",
            messages: [],
          },
          remoteConfig: { remote: true },
        },
      });

      const config: PromptsConfig = {
        prompts: { "runtime-config": "file:prompts/runtime.prompt.yaml" },
      };
      const lock: PromptsLock = {
        lockfileVersion: 1,
        prompts: {
          "runtime-config": {
            version: 1,
            versionId: "v1",
            materialized: "prompts/runtime.prompt.yaml",
          },
        },
      };
      const result: SyncResult = {
        fetched: [],
        pushed: [],
        unchanged: [],
        cleaned: [],
        errors: [],
      };

      await pushPrompts({
        config,
        lock,
        promptsApiService,
        result,
        forceResolution: "remote",
      });

      const writtenYaml = mockWriteFileSync.mock.calls[0]?.[1] as string;
      expect(yaml.load(writtenYaml)).toMatchObject({
        config: { remote: true },
      });
    });
  });
});
