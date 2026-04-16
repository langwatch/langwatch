import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/client-sdk/services/prompts", () => ({
  PromptsApiService: vi.fn(),
  PromptsApiError: class extends Error {},
}));

vi.mock("../../../utils/apiKey", () => ({
  checkApiKey: vi.fn(),
}));

vi.mock("readline", () => ({
  default: {
    createInterface: vi.fn(),
  },
  createInterface: vi.fn(),
}));

import { tagDeleteCommand } from "../delete";
import { PromptsApiService } from "@/client-sdk/services/prompts";
import * as readline from "readline";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const setupReadlineMock = (answer: string) => {
  const mockClose = vi.fn();
  const mockQuestion = vi.fn().mockImplementation((_prompt, cb) => {
    cb(answer);
  });
  vi.mocked(readline.createInterface).mockReturnValue({
    question: mockQuestion,
    close: mockClose,
  } as unknown as ReturnType<typeof readline.createInterface>);
  return { mockQuestion, mockClose };
};

describe("tagDeleteCommand", () => {
  let mockDeleteTag: ReturnType<typeof vi.fn>;
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteTag = vi.fn();
    vi.mocked(PromptsApiService).mockImplementation(
      () => ({ deleteTag: mockDeleteTag }) as unknown as InstanceType<typeof PromptsApiService>,
    );
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError(code as number);
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // vitest runs in a non-TTY environment by default, but the existing
    // tests assume the interactive prompt path. Pin isTTY=true so those
    // tests stay deterministic.
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
  });

  describe("when confirmation matches the tag name", () => {
    it("calls deleteTag with the tag name", async () => {
      setupReadlineMock("canary");
      mockDeleteTag.mockResolvedValue(undefined);

      await tagDeleteCommand("canary");

      expect(mockDeleteTag).toHaveBeenCalledWith("canary");
    });

    it("prints confirmation message", async () => {
      setupReadlineMock("canary");
      mockDeleteTag.mockResolvedValue(undefined);

      await tagDeleteCommand("canary");

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Deleted tag: canary"));
    });
  });

  describe("when confirmation does not match the tag name", () => {
    it("does not call deleteTag", async () => {
      setupReadlineMock("wrong");

      await tagDeleteCommand("canary");

      expect(mockDeleteTag).not.toHaveBeenCalled();
    });

    it("prints aborted message", async () => {
      setupReadlineMock("wrong");

      await tagDeleteCommand("canary");

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Aborted"));
    });

    it("exits with code 0 (returns without error)", async () => {
      setupReadlineMock("wrong");

      // Should not throw
      await expect(tagDeleteCommand("canary")).resolves.toBeUndefined();
    });
  });

  describe("when stdin is not a TTY and --force is not set", () => {
    const originalIsTTY = process.stdin.isTTY;

    beforeEach(() => {
      Object.defineProperty(process.stdin, "isTTY", {
        value: false,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    });

    it("exits with an actionable error instead of hanging on stdin", async () => {
      await expect(tagDeleteCommand("canary")).rejects.toThrow(
        ProcessExitError,
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("stdin is not a TTY"),
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("--force"),
      );
      expect(mockDeleteTag).not.toHaveBeenCalled();
    });
  });

  describe("when --force flag is set", () => {
    it("skips confirmation and calls deleteTag directly", async () => {
      mockDeleteTag.mockResolvedValue(undefined);

      await tagDeleteCommand("canary", { force: true });

      expect(readline.createInterface).not.toHaveBeenCalled();
      expect(mockDeleteTag).toHaveBeenCalledWith("canary");
    });

    it("prints confirmation message", async () => {
      mockDeleteTag.mockResolvedValue(undefined);

      await tagDeleteCommand("canary", { force: true });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Deleted tag: canary"));
    });
  });
});
