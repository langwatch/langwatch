/**
 * `showErrorToast` is the only sanctioned error toast, so these pin the three
 * decisions it makes on every call: whose headline wins, that dedup is
 * automatic, and that a customer never reads a code slug or a server message.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The subset of the toast payload these tests assert on. */
interface ToastArgs {
  title?: string;
  description?: string;
  // Non-optional: `showErrorToast` always sets `meta`, so the assertions read
  // `toast.meta.traceId` directly.
  meta: { docsUrl?: string; traceId?: string; closable?: boolean };
}
const create = vi.fn<(args: ToastArgs) => void>();
vi.mock("~/components/ui/toaster", () => ({ toaster: { create } }));

const isHandledByGlobalHandler = vi.fn<(error: unknown) => boolean>(
  () => false,
);
vi.mock("~/utils/trpcError", () => ({
  isHandledByGlobalHandler: (error: unknown) =>
    isHandledByGlobalHandler(error as never),
}));

const { showErrorToast } = await import("../showErrorToast");

const handledError = (
  error: Record<string, unknown> | null,
  traceId?: string,
) => ({ data: { error, ...(traceId ? { traceId } : {}) } });

beforeEach(() => {
  create.mockClear();
  isHandledByGlobalHandler.mockReturnValue(false);
});

describe("showErrorToast", () => {
  describe("given a code the registry knows", () => {
    it("shows the registry copy, not the caller's generic headline", () => {
      showErrorToast({
        error: handledError({ code: "query_timeout", httpStatus: 504 }),
        fallbackTitle: "Couldn't load traces",
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ title: "This search took too long" }),
      );
    });

    it("surfaces the docs link and trace id for the footer to render", () => {
      showErrorToast({
        error: handledError({
          code: "trace_not_found",
          httpStatus: 404,
          docsUrl: "https://docs.langwatch.ai/platform/data-retention",
          traceId: "4bf92f",
        }),
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({
            docsUrl: "https://docs.langwatch.ai/platform/data-retention",
            traceId: "4bf92f",
          }),
        }),
      );
    });

    it("prefers its own copy over the server's tips, rather than saying both", () => {
      showErrorToast({
        error: handledError({
          code: "trace_not_found",
          httpStatus: 404,
          tips: ["Check the trace id", "Retry in a few seconds"],
        }),
      });

      const { description } = create.mock.calls[0]![0];
      expect(description).toContain("may have been deleted");
      expect(description).not.toContain("Check the trace id");
    });
  });

  describe("given a code with no copy but server tips", () => {
    it("falls back to the most actionable tip", () => {
      showErrorToast({
        error: handledError({
          code: "some_future_code",
          httpStatus: 400,
          tips: ["Rotate the key", "Then retry"],
        }),
      });

      const { description } = create.mock.calls[0]![0];
      expect(description).toBe("Rotate the key");
    });
  });

  describe("given a code the registry has never seen", () => {
    it("uses the caller's headline, so the user knows what failed", () => {
      showErrorToast({
        error: handledError({ code: "some_future_code", httpStatus: 400 }),
        fallbackTitle: "Couldn't create project",
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Couldn't create project" }),
      );
    });
  });

  describe("given an unhandled failure", () => {
    it("says nothing about what broke, but keeps the trace id", () => {
      showErrorToast({
        error: handledError(null, "4bf92f"),
        fallbackTitle: "Couldn't save",
      });

      const toast = create.mock.calls[0]![0];
      expect(toast.title).toBe("Couldn't save");
      expect(toast.meta.traceId).toBe("4bf92f");
      expect(toast.description).not.toMatch(/prisma|sql|postgres/i);
    });
  });

  describe("given a global handler already reported the error", () => {
    it("shows nothing, rather than duplicating it as toast plus modal", () => {
      isHandledByGlobalHandler.mockReturnValue(true);

      showErrorToast({
        error: handledError({
          code: "lite_member_restricted",
          httpStatus: 403,
        }),
      });

      expect(create).not.toHaveBeenCalled();
    });
  });

  it("renders the registry's copy as the title, not the code slug", () => {
    showErrorToast({
      error: handledError({ code: "validation_error", httpStatus: 422 }),
    });

    // Asserting the positive: `not.toBe("validation_error")` also passes for
    // `""`, `"validation_error "` and `"Error: validation_error"`, so it was
    // an assertion that could barely fail.
    expect(create.mock.calls[0]![0].title).toBe("Check your input");
  });

  describe("given a plain 4xx the procedure wrote copy for", () => {
    /**
     * #5984 collapsed the wire message to the code for handled errors, but
     * deliberately left a non-5xx `TRPCError`'s message alone — several hundred
     * throw sites write real copy there ("That name is taken"), and replacing
     * it with "we've been notified" tells the user to wait for something that
     * will never change. This is the branch that keeps that promise.
     */
    it("shows the authored sentence", () => {
      showErrorToast({
        error: {
          message: "You've already used this invite.",
          // Stamped by the boundary; see `readAuthoredMessage`.
          data: { httpStatus: 400, authored: true },
        },
        fallbackTitle: "Couldn't accept the invite",
      });

      const toast = create.mock.calls[0]![0];
      expect(toast.title).toBe("Couldn't accept the invite");
      expect(toast.description).toBe("You've already used this invite.");
    });

    it("refuses a message a driver wrote rather than a person", () => {
      showErrorToast({
        error: {
          message:
            "Invalid `prisma.project.create()` invocation: connect ECONNREFUSED 10.0.0.4:5432",
          data: { httpStatus: 400, authored: true },
        },
        fallbackTitle: "Couldn't create the project",
      });

      const toast = create.mock.calls[0]![0];
      expect(toast.description).not.toMatch(/prisma|ECONNREFUSED|10\.0\.0\.4/i);
    });

    it("refuses one at 5xx, where the message is never customer copy", () => {
      showErrorToast({
        error: {
          message: "Unexpected token in JSON",
          data: { httpStatus: 500, authored: true },
        },
        fallbackTitle: "Couldn't save",
      });

      expect(create.mock.calls[0]![0].description).not.toContain(
        "Unexpected token",
      );
    });
  });

  describe("given a 4xx the boundary did not mark authored", () => {
    it("degrades to the generic state rather than reciting it", () => {
      showErrorToast({
        // `new TRPCError({ code: "NOT_FOUND" })` — tRPC defaults the message
        // to the code NAME, and there is no `authored` flag on it.
        error: { message: "NOT_FOUND", data: { httpStatus: 404 } },
        fallbackTitle: "Couldn't open the trace",
      });

      const toast = create.mock.calls[0]![0];
      expect(toast.title).toBe("Couldn't open the trace");
      expect(toast.description).not.toContain("NOT_FOUND");
    });
  });

  describe("on every error toast", () => {
    /**
     * Both are deliberate and neither was asserted: the shared 5s default is
     * not long enough to read the copy and click through to the docs or the
     * error id, and dropping `closable` leaves an error toast with no close
     * button, because the Toaster only renders `Toast.CloseTrigger` when
     * `meta.closable` is set.
     */
    it("stays long enough to read and dismissable by hand", () => {
      showErrorToast({
        error: handledError(null),
        fallbackTitle: "Couldn't save",
      });

      const toast = create.mock.calls[0]![0] as ToastArgs & {
        duration?: number;
      };
      expect(toast.duration).toBe(12000);
      expect(toast.meta.closable).toBe(true);
    });
  });
});
