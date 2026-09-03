/**
 * How a failure reaches a reader, and which words it arrives in.
 *
 * The one thing that must not happen is the wire message reaching the page: for
 * a handled error that message IS the code slug, so a composition that toasted
 * it would show a customer `validation_error`. These pin that the copy comes
 * from the code-keyed presentation registry — for EVERY code the platform can
 * emit, not a handful — and that a failure the registry cannot name degrades to
 * the action the reader was taking plus ADR-045's one calm generic line and a
 * trace id.
 */

import { goErrorCodes, nodeErrorCodes } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";
import {
  BrowserUiFeedback,
  resolveUiFailureCopy,
  type UiToaster,
} from "../src/behavior/ui-feedback";
import { APP_ERROR_CODES } from "../src/model/errors/codes";
import { UNKNOWN_ERROR_PRESENTATION } from "../src/model/errors/presentation";

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

/** Every code a client must have copy for — app, plus the generated Go and node sets. */
const ALL_CODES = [
  ...APP_ERROR_CODES,
  ...Object.keys(goErrorCodes),
  ...Object.keys(nodeErrorCodes),
];

/** The shape a tRPC boundary sends a handled error in. */
const trpcFailure = (code: string, payload: Record<string, unknown> = {}) => ({
  data: { error: { code, httpStatus: 403, ...payload } },
});

/** A headline no registry entry could ever produce, so its survival is a miss. */
const SENTINEL_TITLE = "ZZ screen fallback ZZ";

describe("given a failure a screen hands over", () => {
  describe("when it carries a code the registry knows", () => {
    it("uses the registry copy rather than the action name", () => {
      const copy = resolveUiFailureCopy({
        error: trpcFailure("insufficient_permissions", {
          meta: { required_permission: "PROJECT_DELETE" },
        }),
        fallbackTitle: "Couldn't archive the source",
      });

      expect(copy.title).toBe("You don't have permission to do this");
      expect(copy.description).toBe('Ask an organization admin to grant you "PROJECT_DELETE".');
    });

    it("reads it off a flat REST body too, not only the tRPC envelope", () => {
      const copy = resolveUiFailureCopy({
        error: { error: "rate_limited", message: "rate limited" },
        fallbackTitle: "Couldn't archive the source",
      });

      expect(copy.title).toBe("Too many requests");
      expect(copy.description).toBe("Slow down for a moment, then try again.");
    });

    /**
     * The property the four-entry copy table this module used to carry could
     * never have: EVERY enumerated code resolves to copy written for it. A
     * miss shows up as the screen's own sentinel headline surviving, which is
     * exactly what a customer would have seen.
     */
    it("answers for every code the platform can emit, not a hand-picked few", () => {
      expect(ALL_CODES.length).toBeGreaterThan(100);

      for (const code of ALL_CODES) {
        const copy = resolveUiFailureCopy({
          error: trpcFailure(code),
          fallbackTitle: SENTINEL_TITLE,
        });

        expect(copy.title, code).not.toBe(SENTINEL_TITLE);
        expect(copy.title.length, code).toBeGreaterThan(0);
        expect(copy.title, code).not.toBe(code);
      }
    });

    it("never puts the screen's own description over registered copy", () => {
      const copy = resolveUiFailureCopy({
        error: trpcFailure("service_unavailable"),
        fallbackTitle: "Couldn't start the run",
        description: "Please try again in a moment.",
      });

      expect(copy.title).toBe("This deployment doesn't offer that");
      expect(copy.description).not.toContain("Please try again in a moment.");
    });
  });

  describe("when the server sent remediation tips with it", () => {
    it("folds in the one tip the registry description did not already say", () => {
      const copy = resolveUiFailureCopy({
        error: trpcFailure("clickhouse_unavailable", {
          tips: ["Check the LangWatch status page or contact support"],
        }),
        fallbackTitle: "Couldn't load the traces",
      });

      expect(copy.description).toContain("Check the LangWatch status page or contact support");
    });

    it("drops a tip that only repeats the description", () => {
      const copy = resolveUiFailureCopy({
        error: trpcFailure("rate_limited", {
          tips: ["Slow down for a moment, then try again"],
        }),
        fallbackTitle: "Couldn't load the traces",
      });

      expect(copy.description).toBe("Slow down for a moment, then try again.");
    });
  });

  describe("when it carries a code this client has never seen", () => {
    it("says what the reader was doing, and offers the trace id", () => {
      const copy = resolveUiFailureCopy({
        error: {
          data: {
            error: { code: "dataset_import_stalled", httpStatus: 409, traceId: "abc123" },
          },
        },
        fallbackTitle: "Couldn't archive the source",
        description: "Nothing was changed.",
      });

      expect(copy.title).toBe("Couldn't archive the source");
      expect(copy.description).toBe("Nothing was changed.");
      expect(copy.traceId).toBe("abc123");
    });
  });

  describe("when it carries no handled payload at all", () => {
    it("gives one calm generic line, the trace id, and nothing about the internals", () => {
      const failure = Object.assign(new Error("connect ECONNREFUSED 10.0.0.4:5432"), {
        data: { traceId: "trace-9" },
      });

      const copy = resolveUiFailureCopy({
        error: failure,
        fallbackTitle: "Couldn't archive the source",
      });

      expect(copy.title).toBe("Couldn't archive the source");
      expect(copy.description).toBe(UNKNOWN_ERROR_PRESENTATION.description);
      expect(copy.traceId).toBe("trace-9");
      expect(JSON.stringify(copy)).not.toContain("ECONNREFUSED");
    });

    it("keeps prose a non-5xx procedure authored for the reader", () => {
      const failure = Object.assign(new Error("You've already used this invite"), {
        data: { httpStatus: 400, authored: true },
      });

      const copy = resolveUiFailureCopy({
        error: failure,
        fallbackTitle: "Couldn't accept the invite",
      });

      expect(copy.description).toBe("You've already used this invite");
    });
  });

  describe("when the screen overrides the headline outright", () => {
    it("keeps the screen's title even for a code the registry knows", () => {
      const copy = resolveUiFailureCopy({
        error: trpcFailure("rate_limited"),
        fallbackTitle: "Couldn't archive the source",
        title: "The test fire did not go out",
      });

      expect(copy.title).toBe("The test fire did not go out");
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
      expect(toasts[0]?.title).toBe("Not found");
      expect(toasts[0]?.duration).toBe(12_000);
    });

    it("carries the docs link and the error id for the toast footer to render", () => {
      const { toaster, toasts } = recordingToaster();

      BrowserUiFeedback.create(toaster).failed({
        error: trpcFailure("clickhouse_unavailable", {
          docsUrl: "https://docs.langwatch.ai/support",
          traceId: "trace-1",
        }),
        fallbackTitle: "Couldn't load the traces",
      });

      expect(toasts[0]?.meta).toEqual({
        docsUrl: "https://docs.langwatch.ai/support",
        traceId: "trace-1",
      });
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
