import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import {
  DatasetApiError,
  DatasetNotFoundError,
  DatasetPlanLimitError,
} from "@/client-sdk/services/datasets/errors";
import { handleDatasetCommandError } from "../error-handler";

describe("handleDatasetCommandError", () => {
  let consoleErrorSpy: MockInstance<typeof console.error>;
  let processExitSpy: MockInstance<typeof process.exit>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      /* suppress */
    });
    processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number | string | null) => {
        throw new Error("process.exit called");
      }) as (code?: number | string | null) => never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function callHandler(error: unknown, context: string): string[] {
    try {
      handleDatasetCommandError(error, context);
    } catch {
      // expected
    }
    return consoleErrorSpy.mock.calls.map((c) => String(c[0]));
  }

  describe("when the error is a DatasetNotFoundError", () => {
    it("prefixes the output with 'Not found:'", () => {
      const output = callHandler(new DatasetNotFoundError("my-ds"), "fetching");
      expect(output.join("\n")).toContain("Not found");
      expect(output.join("\n")).toContain("my-ds");
    });
  });

  describe("when the error is a DatasetPlanLimitError", () => {
    it("shows the 'Plan limit reached' prefix with current and max usage", () => {
      const err = new DatasetPlanLimitError(
        "Dataset limit reached for FREE plan (max 3)",
        { limitType: "datasets", current: 3, max: 3 },
      );
      const output = callHandler(err, "creating");
      expect(output.join("\n")).toContain("Plan limit reached");
      expect(output.join("\n")).toContain("datasets");
      expect(output.join("\n")).toContain("3");
      expect(output.join("\n")).toContain("/ 3");
    });

    it("works without current/max fields", () => {
      const err = new DatasetPlanLimitError(
        "Dataset limit reached for FREE plan (max 3)",
      );
      const output = callHandler(err, "creating");
      expect(output.join("\n")).toContain("Plan limit reached");
    });
  });

  describe("when the error is a generic DatasetApiError", () => {
    it("prefixes the output with 'Error:'", () => {
      const err = new DatasetApiError(
        "Failed to fetch dataset: unexpected payload",
        500,
        "fetch",
      );
      const output = callHandler(err, "fetching");
      expect(output.join("\n")).toContain("Error");
      expect(output.join("\n")).toContain("unexpected payload");
    });
  });

  describe("when the error is unknown", () => {
    it("includes the operation context in the message", () => {
      const output = callHandler(new Error("something broke"), "deleting");
      expect(output.join("\n")).toContain("deleting");
      expect(output.join("\n")).toContain("something broke");
    });
  });

  it("always calls process.exit(1)", () => {
    try {
      handleDatasetCommandError(new Error("x"), "y");
    } catch {
      /* ignore */
    }
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
