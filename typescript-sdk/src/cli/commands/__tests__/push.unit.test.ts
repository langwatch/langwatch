import { describe, it, expect, vi, beforeEach } from "vitest";
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
          schema: { type: "object", properties: { value: { type: "string" } } },
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
});
