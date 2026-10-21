import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type UiFailureNotice,
  type UiSuccessNotice,
  UNAVAILABLE_UI_FEEDBACK,
} from "../capabilities.ts";
import { reportUiFailure, setUiFeedbackHost, toaster } from "../toaster.ts";

function recordingHost() {
  const succeeded: UiSuccessNotice[] = [];
  const warned: UiSuccessNotice[] = [];
  const informed: UiSuccessNotice[] = [];
  const failed: UiFailureNotice[] = [];
  return {
    succeeded,
    warned,
    informed,
    failed,
    host: {
      succeeded: (notice: UiSuccessNotice) => void succeeded.push(notice),
      warned: (notice: UiSuccessNotice) => void warned.push(notice),
      informed: (notice: UiSuccessNotice) => void informed.push(notice),
      failed: (failure: UiFailureNotice) => void failed.push(failure),
    },
  };
}

afterEach(() => {
  setUiFeedbackHost(void 0);
  vi.restoreAllMocks();
});

describe("toaster", () => {
  describe("when a feedback host is mounted", () => {
    it("reports an error toast as a failure with the error still on it", () => {
      const { failed, host } = recordingHost();
      setUiFeedbackHost(host);
      const error = new Error("boom");

      toaster.create({ title: "Couldn't save", type: "error", error, id: "save" });

      expect(failed).toHaveLength(1);
      expect(failed[0]?.error).toBe(error);
      expect(failed[0]?.fallbackTitle).toBe("Couldn't save");
      expect(failed[0]?.id).toBe("save");
    });

    it("carries a toast action across as the failure's one way out", () => {
      const { failed, host } = recordingHost();
      setUiFeedbackHost(host);
      const onClick = vi.fn<() => void>();

      toaster.error({ title: "No model configured", action: { label: "Configure", onClick } });
      failed[0]?.action?.run();

      expect(failed[0]?.action?.label).toBe("Configure");
      expect(onClick).toHaveBeenCalled();
    });

    /** @scenario A warning or information toast keeps its tone */
    it("reports a warning as a warning and an info toast as information, never as a success", () => {
      const { succeeded, warned, informed, host } = recordingHost();
      setUiFeedbackHost(host);

      toaster.create({ title: "To save, pick a delivery channel.", type: "warning" });
      toaster.info({ title: "A run is already in progress" });

      expect(warned).toEqual([
        { title: "To save, pick a delivery channel.", description: void 0, id: void 0 },
      ]);
      expect(informed).toEqual([
        { title: "A run is already in progress", description: void 0, id: void 0 },
      ]);
      expect(succeeded).toEqual([]);
    });

    it("reports a success toast as a success", () => {
      const { succeeded, host } = recordingHost();
      setUiFeedbackHost(host);

      toaster.create({ title: "Saved", description: "The prompt is live", type: "success" });

      expect(succeeded).toEqual([
        { title: "Saved", description: "The prompt is live", id: void 0 },
      ]);
    });
  });

  describe("when no feedback host is mounted", () => {
    it("warns and drops the toast rather than throwing", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      expect(() => toaster.create({ title: "Couldn't save", type: "error" })).not.toThrow();
      expect(warn).toHaveBeenCalled();
    });
  });

  describe("when the mounted host is the unavailable stand-in", () => {
    /** @scenario A report with no working feedback host is logged, never thrown */
    it.each([
      ["an error", { title: "Couldn't copy", type: "error" as const }],
      ["a success", { title: "Copied", type: "success" as const }],
      ["a warning", { title: "Heads up", type: "warning" as const }],
    ])("warns and drops %s rather than throwing", (_name, toast) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      setUiFeedbackHost(UNAVAILABLE_UI_FEEDBACK);

      expect(() => toaster.create(toast)).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.any(String), toast.title);
    });
  });
});

describe("reportUiFailure", () => {
  describe("when a feedback host is mounted", () => {
    it("hands it the failure untouched", () => {
      const { failed, host } = recordingHost();
      setUiFeedbackHost(host);

      reportUiFailure({ error: new Error("x"), fallbackTitle: "Model unavailable", sticky: true });

      expect(failed).toHaveLength(1);
      expect(failed[0]?.sticky).toBe(true);
    });
  });

  describe("when no feedback host is mounted", () => {
    /** @scenario A report with no working feedback host is logged, never thrown */
    it("warns with the failure's title and does not throw", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      expect(() =>
        reportUiFailure({ error: new Error("x"), fallbackTitle: "Model unavailable" }),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.any(String), "Model unavailable");
    });
  });

  describe("when the mounted host is the unavailable stand-in", () => {
    /** @scenario A report with no working feedback host is logged, never thrown */
    it("warns with the failure's title and does not throw", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      setUiFeedbackHost(UNAVAILABLE_UI_FEEDBACK);

      expect(() =>
        reportUiFailure({
          error: new Error("x"),
          fallbackTitle: "Model unavailable",
          title: "Gone",
        }),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.any(String), "Gone");
    });
  });
});
