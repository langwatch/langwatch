import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import type { Ora } from "ora";
import {
  DatasetApiError,
  DatasetNotFoundError,
  DatasetPlanLimitError,
} from "@/client-sdk/services/datasets/errors";
import { handleDatasetCommandError } from "../error-handler";

describe("handleDatasetCommandError", () => {
  let consoleErrorSpy: MockInstance<typeof console.error>;
  let processExitSpy: MockInstance<typeof process.exit>;
  let spinnerFail: ReturnType<typeof vi.fn>;
  let spinner: Ora;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      /* suppress */
    });
    processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number | string | null) => {
        throw new Error("process.exit called");
      }) as (code?: number | string | null) => never);
    spinnerFail = vi.fn();
    spinner = { fail: spinnerFail } as unknown as Ora;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function callHandler(error: unknown, context: string): { spinnerCalls: string[]; errorCalls: string[] } {
    try {
      handleDatasetCommandError({ spinner, error, context });
    } catch {
      // expected
    }
    return {
      spinnerCalls: spinnerFail.mock.calls.map((c) => String(c[0])),
      errorCalls: consoleErrorSpy.mock.calls.map((c) => String(c[0])),
    };
  }

  describe("when the error is a DatasetNotFoundError", () => {
    it("prefixes the spinner fail with 'Not found:'", () => {
      const { spinnerCalls } = callHandler(new DatasetNotFoundError("my-ds"), "fetch dataset");
      expect(spinnerCalls.join("\n")).toContain("Not found");
      expect(spinnerCalls.join("\n")).toContain("my-ds");
    });
  });

  describe("when the error is a DatasetPlanLimitError", () => {
    it("shows the 'Plan limit reached' prefix with current and max usage", () => {
      const err = new DatasetPlanLimitError(
        "Dataset limit reached for FREE plan (max 3)",
        { limitType: "datasets", current: 3, max: 3 },
      );
      const { spinnerCalls, errorCalls } = callHandler(err, "create dataset");
      expect(spinnerCalls.join("\n")).toContain("Plan limit reached");
      const combined = [...spinnerCalls, ...errorCalls].join("\n");
      expect(combined).toContain("datasets");
      expect(combined).toContain("3");
      expect(combined).toContain("/ 3");
    });

    it("works without current/max fields", () => {
      const err = new DatasetPlanLimitError(
        "Dataset limit reached for FREE plan (max 3)",
      );
      const { spinnerCalls } = callHandler(err, "create dataset");
      expect(spinnerCalls.join("\n")).toContain("Plan limit reached");
    });
  });

  describe("when the error is a generic DatasetApiError", () => {
    it("renders the error message on the spinner fail line", () => {
      const err = new DatasetApiError(
        "Failed to fetch dataset: unexpected payload",
        500,
        "fetch",
      );
      const { spinnerCalls } = callHandler(err, "fetch dataset");
      expect(spinnerCalls.join("\n")).toContain("unexpected payload");
    });
  });

  describe("when the error is unknown", () => {
    it("includes the operation context in the spinner fail message", () => {
      const { spinnerCalls } = callHandler(new Error("something broke"), "delete dataset");
      expect(spinnerCalls.join("\n")).toContain("delete dataset");
      expect(spinnerCalls.join("\n")).toContain("something broke");
    });
  });

  it("always calls process.exit(1)", () => {
    try {
      handleDatasetCommandError({ spinner, error: new Error("x"), context: "y" });
    } catch {
      /* ignore */
    }
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
