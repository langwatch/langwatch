/**
 * `showErrorToast` is the only sanctioned error toast, so these pin the three
 * decisions it makes on every call: whose headline wins, that dedup is
 * automatic, and that a customer never reads a code slug or a server message.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("~/components/ui/toaster", () => ({ toaster: { create } }));

const isHandledByGlobalHandler = vi.fn(() => false);
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
      showErrorToast(
        handledError({ code: "query_timeout", httpStatus: 504 }),
        { fallbackTitle: "Couldn't load traces" },
      );

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ title: "This search took too long" }),
      );
    });

    it("surfaces the docs link and trace id for the footer to render", () => {
      showErrorToast(
        handledError({
          code: "trace_not_found",
          httpStatus: 404,
          docsUrl: "https://docs.langwatch.ai/platform/data-retention",
          traceId: "4bf92f",
        }),
      );

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
      showErrorToast(
        handledError({
          code: "trace_not_found",
          httpStatus: 404,
          tips: ["Check the trace id", "Retry in a few seconds"],
        }),
      );

      const { description } = create.mock.calls[0]![0];
      expect(description).toContain("may have been deleted");
      expect(description).not.toContain("Check the trace id");
    });
  });

  describe("given a code with no copy but server tips", () => {
    it("falls back to the most actionable tip", () => {
      showErrorToast(
        handledError({
          code: "some_future_code",
          httpStatus: 400,
          tips: ["Rotate the key", "Then retry"],
        }),
      );

      const { description } = create.mock.calls[0]![0];
      expect(description).toBe("Rotate the key");
    });
  });

  describe("given a code the registry has never seen", () => {
    it("uses the caller's headline, so the user knows what failed", () => {
      showErrorToast(
        handledError({ code: "some_future_code", httpStatus: 400 }),
        { fallbackTitle: "Couldn't create project" },
      );

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Couldn't create project" }),
      );
    });
  });

  describe("given an unhandled failure", () => {
    it("says nothing about what broke, but keeps the trace id", () => {
      showErrorToast(handledError(null, "4bf92f"), {
        fallbackTitle: "Couldn't save",
      });

      const toast = create.mock.calls[0]![0];
      expect(toast.title).toBe("Couldn't save");
      expect(toast.meta.traceId).toBe("4bf92f");
      expect(toast.description).not.toMatch(/prisma|sql|postgres/i);
    });
  });

  describe("when a global handler already reported the error", () => {
    it("shows nothing, rather than duplicating it as toast plus modal", () => {
      isHandledByGlobalHandler.mockReturnValue(true);

      showErrorToast(handledError({ code: "lite_member_restricted", httpStatus: 403 }));

      expect(create).not.toHaveBeenCalled();
    });
  });

  it("never renders the code slug as the title", () => {
    showErrorToast(handledError({ code: "validation_error", httpStatus: 422 }));

    expect(create.mock.calls[0]![0].title).not.toBe("validation_error");
  });
});
