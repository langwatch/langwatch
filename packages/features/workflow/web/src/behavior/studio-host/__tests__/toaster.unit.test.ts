/**
 * The studio's toast seam: what it routes, and what it refuses to invent.
 *
 * Twenty-five studio files call `toaster.create`, and this module is the only
 * thing between them and the application. Nothing is rendered here — every
 * failure leaves through `WorkflowHostPort.failed`, which is what lets the
 * application's code-keyed registry write the words. These pin the two halves
 * that were silently lost before: the failure ITSELF, which used to be dropped
 * so every studio failure resolved to the generic unknown line, and the offered
 * ACTION, which used to be a button rendered inside a `description` node the
 * port takes as text.
 */

import { describe, expect, it, vi } from "vitest";

import type { WorkflowFailureNotice, WorkflowSuccessNotice } from "../../../model/workflow-host";
import type { WorkflowHostPort } from "../../../model/workflow-host";
import { setStudioFeedbackHost, toaster } from "../toaster";

function recordingHost(): {
  host: WorkflowHostPort;
  failures: WorkflowFailureNotice[];
  successes: WorkflowSuccessNotice[];
} {
  const failures: WorkflowFailureNotice[] = [];
  const successes: WorkflowSuccessNotice[] = [];
  return {
    failures,
    successes,
    host: {
      failed: (failure: WorkflowFailureNotice) => failures.push(failure),
      succeeded: (notice: WorkflowSuccessNotice) => successes.push(notice),
    } as unknown as WorkflowHostPort,
  };
}

describe("given a host is mounted", () => {
  describe("when a studio module raises an error toast", () => {
    it("hands the failure over whole, for the application to explain", () => {
      const { host, failures } = recordingHost();
      setStudioFeedbackHost(host);
      const failure = { code: "invalid_dataset", httpStatus: 400 };

      toaster.create({ error: failure, title: "This run didn't finish", type: "error" });
      setStudioFeedbackHost(void 0);

      // The whole point: the words are not decided here. Handing over only a
      // title is what made every studio failure read as the generic unknown
      // line even where the engine had named it.
      expect(failures).toHaveLength(1);
      expect(failures[0]?.error).toBe(failure);
      expect(failures[0]?.fallbackTitle).toBe("This run didn't finish");
    });

    it("carries the one way out it offered", () => {
      const { host, failures } = recordingHost();
      setStudioFeedbackHost(host);
      const goToComponent = vi.fn();

      toaster.create({
        title: "That step didn't run",
        type: "error",
        action: { label: "Go to component", onClick: goToComponent },
      });
      setStudioFeedbackHost(void 0);

      expect(failures[0]?.action?.label).toBe("Go to component");
      failures[0]?.action?.run();
      expect(goToComponent).toHaveBeenCalledTimes(1);
    });

    it("leaves the failure unset when the call site had none to give", () => {
      const { host, failures } = recordingHost();
      setStudioFeedbackHost(host);

      toaster.create({ title: "Studio is not connected yet", type: "error" });
      setStudioFeedbackHost(void 0);

      // A browser-side gate never crossed a wire, so there is nothing for the
      // registry to read and nothing may be invented in its place.
      expect(failures[0]?.error).toBeUndefined();
    });
  });

  describe("when a studio module raises anything else", () => {
    it("reports it as a success notice rather than a failure", () => {
      const { host, failures, successes } = recordingHost();
      setStudioFeedbackHost(host);

      toaster.create({ title: "Version saved", type: "success" });
      setStudioFeedbackHost(void 0);

      expect(failures).toEqual([]);
      expect(successes[0]?.title).toBe("Version saved");
    });
  });
});

describe("given no host is mounted", () => {
  describe("when a studio module raises a toast", () => {
    it("drops it with a warning rather than taking the page down", () => {
      setStudioFeedbackHost(void 0);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => void 0);

      expect(() => toaster.create({ title: "Couldn't save", type: "error" })).not.toThrow();
      expect(warn).toHaveBeenCalled();

      warn.mockRestore();
    });
  });
});
