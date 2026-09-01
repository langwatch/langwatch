/**
 * How a failure reaches a reader, and which words it arrives in.
 *
 * The one thing that must not happen is the wire message reaching the page: for
 * a handled error that message IS the code slug, so a composition that toasted
 * it would show a customer `validation_error`. These pin that the copy is
 * resolved from the code and that an unrecognised code degrades to the action
 * name plus the generic line, rather than to nothing or to internals.
 */

import { describe, expect, it } from "vitest";
import {
  BrowserUiFeedback,
  readUiFailureCode,
  resolveUiFailureCopy,
  UNKNOWN_UI_FAILURE_DESCRIPTION,
  type UiToaster,
} from "../src/behavior/ui-feedback";

type RecordedToast = Parameters<UiToaster["create"]>[0];

function recordingToaster(): { toaster: UiToaster; toasts: RecordedToast[] } {
  const toasts: RecordedToast[] = [];
  return {
    toasts,
    toaster: {
      create: (toast) => {
        toasts.push(toast);
        return toast;
      },
    },
  };
}

/** The shape a tRPC boundary sends a handled error in. */
const trpcFailure = (code: string) => ({ data: { error: { code, httpStatus: 403 } } });

describe("given a failure a screen hands over", () => {
  describe("when it carries a code the composition knows", () => {
    it("reads the code off the tRPC envelope", () => {
      expect(readUiFailureCode(trpcFailure("insufficient_permissions"))).toBe(
        "insufficient_permissions",
      );
    });

    it("reads the code off a flat REST body", () => {
      expect(readUiFailureCode({ error: "rate_limited" })).toBe("rate_limited");
    });

    it("uses the registered copy rather than the action name", () => {
      const copy = resolveUiFailureCopy({
        error: trpcFailure("insufficient_permissions"),
        fallbackTitle: "Couldn't archive the source",
      });

      expect(copy.title).toBe("You do not have access to this");
      expect(copy.description).toContain("organization admin");
    });
  });

  describe("when it carries no code we recognise", () => {
    it("says what the reader was doing and nothing about the internals", () => {
      const copy = resolveUiFailureCopy({
        error: new Error("connect ECONNREFUSED 10.0.0.4:5432"),
        fallbackTitle: "Couldn't archive the source",
      });

      expect(copy.title).toBe("Couldn't archive the source");
      expect(copy.description).toBe(UNKNOWN_UI_FAILURE_DESCRIPTION);
      expect(JSON.stringify(copy)).not.toContain("ECONNREFUSED");
    });
  });

  describe("when the port renders it", () => {
    it("raises an error toast that outlives the default five seconds", () => {
      const { toaster, toasts } = recordingToaster();

      BrowserUiFeedback.create(toaster).failed({
        error: trpcFailure("not_found"),
        fallbackTitle: "Couldn't open the source",
      });

      expect(toasts).toHaveLength(1);
      expect(toasts[0]?.type).toBe("error");
      expect(toasts[0]?.title).toBe("That is no longer here");
      expect(toasts[0]?.duration).toBe(12_000);
    });

    it("raises a success toast that carries the screen's own words", () => {
      const { toaster, toasts } = recordingToaster();

      BrowserUiFeedback.create(toaster).succeeded({
        title: "Source archived",
        description: "It will stop pulling within the hour.",
        id: "archive",
      });

      expect(toasts).toEqual([
        {
          id: "archive",
          title: "Source archived",
          description: "It will stop pulling within the hour.",
          type: "success",
        },
      ]);
    });
  });
});
