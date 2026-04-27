import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/client-sdk/services/prompts", () => ({
  PromptsApiService: vi.fn(),
  PromptsApiError: class extends Error {},
}));

vi.mock("../../../utils/apiKey", () => ({
  checkApiKey: vi.fn(),
}));

vi.mock("../../../utils/formatting", () => ({
  formatTable: vi.fn(),
  formatRelativeTime: vi.fn().mockReturnValue("3d ago"),
}));

import { tagListCommand } from "../list";
import { PromptsApiService } from "@/client-sdk/services/prompts";
import { formatTable } from "../../../utils/formatting";

describe("tagListCommand", () => {
  let mockListTags: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockListTags = vi.fn();
    vi.mocked(PromptsApiService).mockImplementation(
      () => ({ listTags: mockListTags }) as unknown as InstanceType<typeof PromptsApiService>,
    );
  });

  describe("when tags exist", () => {
    it("calls formatTable with Name and Created columns", async () => {
      mockListTags.mockResolvedValue([
        { name: "latest", createdAt: "2024-01-01T00:00:00Z" },
        { name: "production", createdAt: "2024-01-02T00:00:00Z" },
        { name: "staging", createdAt: "2024-01-03T00:00:00Z" },
        { name: "canary", createdAt: "2024-01-04T00:00:00Z" },
      ]);

      await tagListCommand();

      expect(formatTable).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: ["Name", "Created"],
          data: expect.arrayContaining([
            expect.objectContaining({ Name: "latest" }),
            expect.objectContaining({ Name: "production" }),
            expect.objectContaining({ Name: "staging" }),
            expect.objectContaining({ Name: "canary" }),
          ]),
        }),
      );
    });
  });

  describe("when no tags exist", () => {
    it("prints the empty state message", async () => {
      mockListTags.mockResolvedValue([]);
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

      await tagListCommand();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("No custom tags found"),
      );
      expect(formatTable).not.toHaveBeenCalled();
    });
  });

  describe("when the API returns an error", () => {
    it("propagates the error (exits 1 via caller)", async () => {
      mockListTags.mockRejectedValue(new Error("list tags failed"));

      await expect(tagListCommand()).rejects.toThrow();
    });
  });
});
