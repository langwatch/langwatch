import { afterEach, describe, expect, it, vi } from "vitest";

import type { UiFailureNotice, UiSuccessNotice } from "../capabilities";
import { setUiFeedbackHost, toaster } from "../toaster";

function recordingHost() {
  const succeeded: UiSuccessNotice[] = [];
  const failed: UiFailureNotice[] = [];
  return {
    succeeded,
    failed,
    host: {
      succeeded: (notice: UiSuccessNotice) => void succeeded.push(notice),
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

    it("reports every other toast as a success", () => {
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
