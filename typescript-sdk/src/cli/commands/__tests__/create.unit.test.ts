import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("../../utils/apiKey", () => ({ checkApiKey: vi.fn() }));
vi.mock("../../utils/init", () => ({
  ensureProjectInitialized: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../utils/fileManager", () => ({
  FileManager: {
    loadPromptsConfig: vi.fn().mockReturnValue({ prompts: {} }),
    savePromptsConfig: vi.fn(),
    loadPromptsLock: vi
      .fn()
      .mockReturnValue({ lockfileVersion: 1, prompts: {} }),
    savePromptsLock: vi.fn(),
  },
}));

import * as fs from "fs";
import { createCommand } from "../create";

describe("prompt sync fidelity — langwatch prompt create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  /** @scenario Creating a prompt via the CLI does not inject a temperature */
  it("writes a modern model and no modelParameters temperature", async () => {
    await createCommand("my-prompt", {});

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const written = vi.mocked(fs.writeFileSync).mock.calls[0]![1] as string;

    expect(written).not.toMatch(/temperature/);
    expect(written).not.toMatch(/modelParameters/);

    const modelLine = /^model:\s*(\S+)/m.exec(written);
    expect(modelLine).toBeTruthy();
    const model = modelLine![1]!;
    // Not a legacy gpt-4 / gpt-3.x generation
    expect(model).not.toMatch(/^openai\/gpt-[0-4]([.-]|$)/);
  });
});
