/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceEditOverlayPatch } from "~/server/traces/edit-overlay/traceEditOverlay.schemas";

const mutate = vi.fn();
const invalidate = vi.fn();
const fetchOverlay = vi.fn();
const toasterCreate = vi.fn();
const showErrorToast = vi.fn();
let mutationOptions: {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
} = {};
let isSaving = false;

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      traceEditOverlay: {
        getByTraceId: { invalidate, fetch: fetchOverlay },
      },
    }),
    traceEditOverlay: {
      upsert: {
        useMutation: (options: typeof mutationOptions) => {
          mutationOptions = options;
          return { mutate, isLoading: isSaving };
        },
      },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: (...args: unknown[]) => toasterCreate(...args) },
}));

vi.mock("~/features/errors", () => ({
  showErrorToast: (...args: unknown[]) => showErrorToast(...args),
}));

import { useDrawerStore } from "../../../../stores/drawerStore";
import { useTraceEditStore } from "../../../../stores/traceEditStore";
import { EditModeBar } from "../EditModeBar";

function renderBar() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <EditModeBar traceId="trace-1" />
    </ChakraProvider>,
  );
}

function saveButton() {
  return screen.getByRole("button", { name: "Save" });
}

/** Saving reads the stored correction back first; by default there is none. */
const storedCorrectionIs = (patch: TraceEditOverlayPatch | null) =>
  fetchOverlay.mockResolvedValue(patch ? { patch } : null);

describe("EditModeBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSaving = false;
    mutationOptions = {};
    storedCorrectionIs(null);
    useTraceEditStore.getState().discard();
    useDrawerStore.getState().setIsEditing(true);
    useTraceEditStore.getState().startEditing({ traceId: "trace-1" });
  });

  afterEach(cleanup);

  describe("given an editing session with nothing changed", () => {
    describe("when the bar renders", () => {
      /** @scenario "Save is unavailable until the reviewer changes something" */
      it("cannot save", () => {
        renderBar();

        expect(saveButton()).toBeDisabled();
      });
    });

    describe("when the reviewer cancels", () => {
      /** @scenario "Cancelling without changes leaves edit mode straight away" */
      it("leaves edit mode without asking", () => {
        renderBar();

        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(
          screen.queryByText("Discard trace edits?"),
        ).not.toBeInTheDocument();
        expect(useDrawerStore.getState().isEditing).toBe(false);
        expect(useTraceEditStore.getState().editingTraceId).toBeNull();
      });
    });
  });

  describe("given a renamed span and a deleted span", () => {
    beforeEach(() => {
      useTraceEditStore.getState().setSpanName({
        spanId: "span-1",
        name: "search the web",
        baselineName: "handler",
      });
      useTraceEditStore.getState().deleteSpan("span-2");
    });

    describe("when the bar renders", () => {
      /** @scenario "Save is unavailable until the reviewer changes something" */
      it("can save", () => {
        renderBar();

        expect(saveButton()).not.toBeDisabled();
      });

      /** @scenario "The bar counts what the correction changes" */
      it("reports one changed field and one deleted span", () => {
        renderBar();

        expect(
          screen.getByText("1 field changed, 1 span deleted"),
        ).toBeInTheDocument();
      });
    });

    describe("when the correction is saved", () => {
      /** @scenario "Saving records the correction and leaves edit mode" */
      it("sends the correction for this trace", async () => {
        renderBar();

        fireEvent.click(saveButton());

        await waitFor(() =>
          expect(mutate).toHaveBeenCalledWith({
            projectId: "proj-1",
            traceId: "trace-1",
            patch: {
              version: 1,
              spans: [{ spanId: "span-1", name: "search the web" }],
              deletedSpanIds: ["span-2"],
            },
          }),
        );
      });

      /** @scenario "Saving records the correction and leaves edit mode" */
      it("confirms the save, rereads the correction and leaves edit mode", async () => {
        renderBar();
        fireEvent.click(saveButton());
        await waitFor(() => expect(mutate).toHaveBeenCalled());

        mutationOptions.onSuccess?.();

        expect(toasterCreate).toHaveBeenCalledWith({
          title: "Trace edits saved",
          type: "success",
        });
        expect(invalidate).toHaveBeenCalledWith({
          projectId: "proj-1",
          traceId: "trace-1",
        });
        expect(useDrawerStore.getState().isEditing).toBe(false);
      });

      /** @scenario "Saving builds on the correction as it stands" */
      it("builds on a correction stored since editing started", async () => {
        storedCorrectionIs({
          version: 1,
          spans: [{ spanId: "span-7", name: "renamed meanwhile" }],
          deletedSpanIds: [],
        });
        renderBar();

        fireEvent.click(saveButton());

        await waitFor(() =>
          expect(mutate).toHaveBeenCalledWith({
            projectId: "proj-1",
            traceId: "trace-1",
            patch: {
              version: 1,
              spans: [
                { spanId: "span-7", name: "renamed meanwhile" },
                { spanId: "span-1", name: "search the web" },
              ],
              deletedSpanIds: ["span-2"],
            },
          }),
        );
      });

      /** @scenario "Saving builds on the correction as it stands" */
      it("writes nothing when the stored correction cannot be read back", async () => {
        fetchOverlay.mockRejectedValue(new Error("offline"));
        renderBar();

        fireEvent.click(saveButton());

        await waitFor(() => expect(showErrorToast).toHaveBeenCalled());
        expect(mutate).not.toHaveBeenCalled();
        expect(useDrawerStore.getState().isEditing).toBe(true);
      });
    });

    describe("when saving fails", () => {
      /** @scenario "A failed save keeps the reviewer in edit mode with their work" */
      it("reports the failure and keeps the changes", async () => {
        renderBar();
        fireEvent.click(saveButton());
        await waitFor(() => expect(mutate).toHaveBeenCalled());

        mutationOptions.onError?.(new Error("nope"));

        expect(showErrorToast).toHaveBeenCalledWith(
          expect.objectContaining({
            fallbackTitle: "Couldn't save trace edits",
          }),
        );
        expect(useDrawerStore.getState().isEditing).toBe(true);
        expect(useTraceEditStore.getState().spanDrafts["span-1"]?.name).toBe(
          "search the web",
        );
      });
    });

    describe("when the reviewer cancels", () => {
      /** @scenario "Cancelling with unsaved changes asks first" */
      it("asks before discarding", async () => {
        renderBar();

        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(
          await screen.findByText("Discard trace edits?"),
        ).toBeInTheDocument();
        expect(
          screen.getByText("Your changes to this trace have not been saved."),
        ).toBeInTheDocument();
        expect(useDrawerStore.getState().isEditing).toBe(true);
      });

      /** @scenario "Cancelling with unsaved changes asks first" */
      it("keeps the changes when the reviewer keeps editing", async () => {
        renderBar();
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        fireEvent.click(
          await screen.findByRole("button", { name: "Keep editing" }),
        );

        expect(useDrawerStore.getState().isEditing).toBe(true);
        expect(useTraceEditStore.getState().spanDrafts["span-1"]?.name).toBe(
          "search the web",
        );
      });

      /** @scenario "Discarding drops the changes and leaves edit mode" */
      it("drops the changes when the reviewer discards", async () => {
        renderBar();
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        fireEvent.click(
          await screen.findByRole("button", { name: "Discard changes" }),
        );

        expect(useDrawerStore.getState().isEditing).toBe(false);
        expect(useTraceEditStore.getState().spanDrafts).toEqual({});
        expect(useTraceEditStore.getState().deletedSpanIds).toEqual([]);
      });
    });
  });
});
