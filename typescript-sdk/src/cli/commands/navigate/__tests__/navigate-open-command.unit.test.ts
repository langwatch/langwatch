import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../utils/apiKey", () => ({
  checkApiKey: vi.fn(),
}));

import { checkApiKey } from "../../../utils/apiKey";
import { navigateOpenCommand } from "../open";

const noop = () => {
  // intentionally empty — suppresses output during tests
};

describe("navigateOpenCommand()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(noop);
  });

  describe("given a resource id", () => {
    it("checks the api key before doing anything else", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(noop);
      await navigateOpenCommand("run_1");

      expect(checkApiKey).toHaveBeenCalledTimes(1);
      // Ordering, not just presence: the key check must run BEFORE any output,
      // so a regression that prints first would fail here.
      const checkOrder = vi.mocked(checkApiKey).mock.invocationCallOrder[0]!;
      const logOrder = log.mock.invocationCallOrder[0]!;
      expect(checkOrder).toBeLessThan(logOrder);
    });

    it("prints only the resource id — never an address", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(noop);
      await navigateOpenCommand("run_1");

      expect(log).toHaveBeenCalledTimes(1);
      const printed = JSON.parse(log.mock.calls[0]![0] as string) as unknown;
      expect(printed).toEqual({ resourceId: "run_1" });
    });
  });
});
