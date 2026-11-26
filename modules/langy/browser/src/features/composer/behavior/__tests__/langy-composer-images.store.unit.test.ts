/**
 * @see modules/langy/specs/langy-image-attachments.feature
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  imageFileParts,
  imagesAllowSend,
  type LangyDraftImage,
  useLangyComposerImages,
} from "../langy-composer-images.store.ts";

const ready: LangyDraftImage = {
  key: "a",
  label: "[▣ pasted-1a2b3c.png]",
  fileName: "pasted-1a2b3c.png",
  mediaType: "image/png",
  status: "ready",
  attachment: {
    objectId: "storedobject_a",
    url: "/api/files/project_1/storedobject_a/pasted-1a2b3c.png",
    filename: "pasted-1a2b3c.png",
    mediaType: "image/png",
    byteLength: 4,
  },
};

describe("useLangyComposerImages", () => {
  beforeEach(() => {
    useLangyComposerImages.setState({ images: [], lastSent: [] });
  });

  describe("given the person pasted an image whose storing failed", () => {
    /** @scenario A failed upload leaves a failed thumbnail that blocks sending */
    it("keeps a failed thumbnail and blocks the send until it is removed", () => {
      const store = useLangyComposerImages.getState();
      store.add({ ...ready, key: "b", status: "uploading", attachment: undefined });
      store.update("b", { status: "failed", error: "Upload failed" });

      const failed = useLangyComposerImages.getState().images;
      expect(failed).toEqual([expect.objectContaining({ key: "b", status: "failed" })]);
      expect(imagesAllowSend(failed)).toBe(false);

      useLangyComposerImages.getState().remove(["b"]);
      expect(imagesAllowSend(useLangyComposerImages.getState().images)).toBe(true);
    });

    /** @scenario A failed upload leaves a failed thumbnail that blocks sending */
    it("blocks the send while an image is still uploading", () => {
      expect(imagesAllowSend([{ ...ready, status: "uploading" }])).toBe(false);
    });
  });

  describe("given an image whose upload was confirmed", () => {
    /** @scenario A confirmed image becomes a file part of the sent message */
    it("sends the image as a file part with its address, name and media type", () => {
      useLangyComposerImages.getState().add(ready);

      const taken = useLangyComposerImages.getState().takeForSend();

      expect(imageFileParts(taken)).toEqual([
        {
          type: "file",
          mediaType: "image/png",
          filename: "pasted-1a2b3c.png",
          url: "/api/files/project_1/storedobject_a/pasted-1a2b3c.png",
        },
      ]);
      expect(useLangyComposerImages.getState().images).toEqual([]);
    });

    /** @scenario A confirmed image becomes a file part of the sent message */
    it("gives the images back when the send fails", () => {
      useLangyComposerImages.getState().add(ready);
      useLangyComposerImages.getState().takeForSend();

      useLangyComposerImages.getState().restoreLastSent();

      expect(useLangyComposerImages.getState().images).toEqual([ready]);
    });
  });
});
