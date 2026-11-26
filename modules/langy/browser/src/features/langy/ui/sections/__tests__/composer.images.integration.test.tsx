/**
 * Images in the composer: paste one and it shows as a thumbnail and as a chip in the text.
 * @vitest-environment jsdom
 * @see modules/langy/specs/langy-image-attachments.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { LangyAttachment } from "@langwatch/langy-contract";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

if (typeof window !== "undefined" && !window.ResizeObserver) {
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}

vi.mock("../../elements/langy-model-pill.tsx", () => ({
  LangyModelPill: () => <div data-testid="model-pill" />,
}));

import { useLangyStore } from "../../../../../behavior/langy.store.ts";
import { useLangyComposerImages } from "../../../../composer/behavior/langy-composer-images.store.ts";
import { Composer } from "../composer.tsx";

const attachmentOf = (file: File): LangyAttachment => ({
  objectId: "storedobject_a",
  url: `/api/files/project_1/storedobject_a/${file.name}`,
  filename: file.name,
  mediaType: file.type,
  byteLength: file.size,
});

function renderComposer({
  uploadImage = async (file: File) => attachmentOf(file),
}: { uploadImage?: (file: File) => Promise<LangyAttachment> } = {}) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <Composer
        model="openai/gpt-5-mini"
        modelOptions={["openai/gpt-5-mini"]}
        onModelChange={() => {}}
        onSend={() => {}}
        disabled={false}
        uploadImage={uploadImage}
      />
    </DesignSystemProvider>,
  );
}

const textarea = () => screen.getByTestId("langy-composer-input") as HTMLTextAreaElement;

const reset = () => {
  useLangyStore.setState({ activeConversationId: null, draft: "", turnPhase: "idle" });
  useLangyComposerImages.setState({ images: [], lastSent: [] });
};

describe("given the Langy composer is open", () => {
  beforeEach(reset);
  afterEach(() => {
    cleanup();
    reset();
  });

  describe("when the person pastes an image", () => {
    /** @scenario The composer shows a thumbnail with a remove button for each attached image */
    it("shows a thumbnail with a remove button and a chip with the image's name in the text", async () => {
      renderComposer();
      fireEvent.change(textarea(), { target: { value: "what is this" } });
      textarea().setSelectionRange(12, 12);

      const image = new File(["PNG!"], "chart.png", { type: "image/png" });
      await act(async () => {
        fireEvent.paste(textarea(), { clipboardData: { files: [image] } });
      });

      expect(useLangyStore.getState().draft).toBe("what is this [▣ chart.png] ");
      expect(
        within(screen.getByTestId("langy-composer-overlay")).getByText("chart.png"),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Remove chart.png" })).toBeTruthy();
      expect(useLangyComposerImages.getState().images).toEqual([
        expect.objectContaining({ fileName: "chart.png", status: "ready" }),
      ]);
    });

    /** @scenario The composer shows a thumbnail with a remove button for each attached image */
    it("takes the image and its chip away when its remove button is pressed", async () => {
      renderComposer();
      const image = new File(["PNG!"], "chart.png", { type: "image/png" });
      await act(async () => {
        fireEvent.paste(textarea(), { clipboardData: { files: [image] } });
      });

      fireEvent.click(screen.getByRole("button", { name: "Remove chart.png" }));

      expect(useLangyStore.getState().draft).not.toContain("chart.png");
      expect(useLangyComposerImages.getState().images).toEqual([]);
    });

    /** @scenario A failed upload leaves a failed thumbnail that blocks sending */
    it("shows a failed thumbnail and keeps Send shut when the upload fails", async () => {
      renderComposer({ uploadImage: async () => Promise.reject(new Error("network down")) });
      fireEvent.change(textarea(), { target: { value: "look" } });
      const image = new File(["PNG!"], "chart.png", { type: "image/png" });
      await act(async () => {
        fireEvent.paste(textarea(), { clipboardData: { files: [image] } });
      });

      expect(useLangyComposerImages.getState().images).toEqual([
        expect.objectContaining({ status: "failed" }),
      ]);
      expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    });

    /** @scenario A failed upload can be tried again from its thumbnail */
    it("uploads the image again when Retry is pressed and opens Send once it is stored", async () => {
      const uploadImage = vi
        .fn<(file: File) => Promise<LangyAttachment>>()
        .mockRejectedValueOnce(new Error("network down"))
        .mockImplementation(async (file) => attachmentOf(file));
      renderComposer({ uploadImage });
      fireEvent.change(textarea(), { target: { value: "look" } });
      const image = new File(["PNG!"], "chart.png", { type: "image/png" });
      await act(async () => {
        fireEvent.paste(textarea(), { clipboardData: { files: [image] } });
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Try uploading chart.png again" }));
      });

      expect(uploadImage).toHaveBeenCalledTimes(2);
      expect(useLangyComposerImages.getState().images).toEqual([
        expect.objectContaining({ fileName: "chart.png", status: "ready" }),
      ]);
      expect(screen.queryByRole("button", { name: /Try uploading/ })).toBeNull();
      expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
    });

    /** @scenario A failed upload can be tried again from its thumbnail */
    it("offers no Retry for a file Langy refused, only its remove button", async () => {
      renderComposer();
      const pdf = new File(["%PDF"], "report.pdf", { type: "application/pdf" });
      await act(async () => {
        fireEvent.paste(textarea(), { clipboardData: { files: [pdf] } });
      });

      expect(useLangyComposerImages.getState().images).toEqual([
        expect.objectContaining({ fileName: "report.pdf", status: "failed" }),
      ]);
      expect(screen.queryByRole("button", { name: /Try uploading/ })).toBeNull();
      expect(screen.getByRole("button", { name: "Remove report.pdf" })).toBeTruthy();
    });
  });

  describe("when it renders", () => {
    /** @scenario The composer has no Context and Skills hint buttons */
    it("shows the model picker and the attach button, and no Context or Skills button", () => {
      renderComposer();

      expect(screen.getByTestId("model-pill")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Attach an image" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Add something from this page/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Pick what Langy should do/ })).toBeNull();
      expect(screen.queryByText("Skills")).toBeNull();
    });
  });
});
