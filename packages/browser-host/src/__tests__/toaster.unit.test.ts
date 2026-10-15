import { afterEach, describe, expect, it, vi } from "vitest";

import type { UiFailureNotice, UiSuccessNotice } from "../capabilities.ts";
import { setUiFeedbackHost, toaster } from "../toaster.ts";

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
});
