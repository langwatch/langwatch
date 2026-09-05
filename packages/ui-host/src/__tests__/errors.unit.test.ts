import { afterEach, describe, expect, it, vi } from "vitest";

import type { UiFailureNotice, UiSuccessNotice } from "../capabilities";
import { applyHandledErrorToForm, describeError, showErrorToast, toError } from "../errors";
import { setUiFeedbackHost } from "../toaster";

function recordingHost() {
  const failed: UiFailureNotice[] = [];
  return {
    failed,
    host: {
      succeeded: (_notice: UiSuccessNotice) => {},
      failed: (failure: UiFailureNotice) => void failed.push(failure),
    },
  };
}

/** A handled error as tRPC carries it. */
const handled = {
  data: {
    error: { code: "validation_error", httpStatus: 400, fault: "customer", meta: {} },
  },
};

afterEach(() => {
  setUiFeedbackHost(void 0);
  vi.restoreAllMocks();
});

describe("showErrorToast", () => {
  describe("when a feedback host is mounted", () => {
    it("hands the failure over whole, with the caller's action named", () => {
      const { failed, host } = recordingHost();
      setUiFeedbackHost(host);

      showErrorToast({ error: handled, fallbackTitle: "Couldn't create project" });

      expect(failed[0]?.error).toBe(handled);
      expect(failed[0]?.fallbackTitle).toBe("Couldn't create project");
    });

    it("names the failure generically when the caller named no action", () => {
      const { failed, host } = recordingHost();
      setUiFeedbackHost(host);

      showErrorToast({ error: new Error("boom") });

      expect(failed[0]?.fallbackTitle).toBe("Something went wrong");
    });
  });

  describe("when no feedback host is mounted", () => {
    it("warns and drops the report rather than throwing", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      expect(() => showErrorToast({ error: new Error("boom") })).not.toThrow();
      expect(warn).toHaveBeenCalled();
    });
  });
});

describe("describeError", () => {
  describe("when the failure carries a code the registry knows", () => {
    it("prefers the registry's headline over the caller's fallback", () => {
      const described = describeError({ error: handled, fallbackTitle: "Couldn't save" });

      expect(described).not.toContain("Couldn't save");
    });
  });

  describe("when the failure carries no code", () => {
    it("leads on the action the caller named", () => {
      const described = describeError({ error: new Error("boom"), fallbackTitle: "Couldn't save" });

      expect(described).toContain("Couldn't save");
    });
  });
});

describe("applyHandledErrorToForm", () => {
  describe("when the server named the fields it rejected", () => {
    it("places each rejection on its own field", () => {
      const setError = vi.fn<(name: string, error: { type: string; message: string }) => void>();
      const placed = applyHandledErrorToForm({
        error: {
          data: {
            error: {
              code: "validation_error",
              httpStatus: 400,
              fault: "customer",
              meta: { fieldErrors: { name: ["That name is taken"] } },
            },
          },
        },
        form: { setError },
      });

      expect(placed).toBe(true);
      expect(setError).toHaveBeenCalledWith("name", {
        type: "server",
        message: "That name is taken",
      });
    });
  });

  describe("when the failure was not a handled one", () => {
    it("places nothing, so the caller still reports it", () => {
      const setError = vi.fn<(name: string, error: { type: string; message: string }) => void>();

      expect(
        applyHandledErrorToForm({
          error: new Error("boom"),
          form: { setError },
          hasFormErrorSlot: true,
        }),
      ).toBe(false);
      expect(setError).not.toHaveBeenCalled();
    });
  });
});

describe("toError", () => {
  it("keeps an Error as it is and coerces anything else", () => {
    const error = new Error("boom");

    expect(toError(error)).toBe(error);
    expect(toError("boom").message).toBe("boom");
    expect(toError({ a: 1 }).message).toBe('{"a":1}');
  });
});
