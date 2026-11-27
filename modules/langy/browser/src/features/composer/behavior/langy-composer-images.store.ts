/**
 * The images the composer's draft holds: each one's chip text, its local preview, and where its
 * upload stands. Spec: modules/langy/specs/langy-image-attachments.feature
 */
import { defineSlice } from "@langwatch/browser-host/global-store";
import type { LangyAttachment } from "@langwatch/langy-contract";

export type LangyDraftImage = Readonly<{
  key: string;
  /** The chip's text in the draft, such as `[▣ pasted-1a2b3c.png]`. */
  label: string;
  fileName: string;
  mediaType: string;
  /** A local object URL of the picked file, for the thumbnail. */
  previewUrl?: string;
  status: "uploading" | "ready" | "failed";
  /** Set once the upload is confirmed. */
  attachment?: LangyAttachment;
  /** What went wrong, for a failed thumbnail. */
  error?: string;
  /** Starts the upload again; only an upload that failed has one, never a refused file. */
  retry?: () => void;
}>;

interface LangyComposerImagesState {
  images: readonly LangyDraftImage[];
  /** The images the last send took, given back if the send fails. */
  lastSent: readonly LangyDraftImage[];
  add: (image: LangyDraftImage) => void;
  update: (key: string, change: Partial<LangyDraftImage>) => void;
  remove: (keys: readonly string[]) => void;
  /** The ready images, taken out of the draft for a send. */
  takeForSend: () => readonly LangyDraftImage[];
  /** The ready images, taken out of the draft for a queued message that keeps them. */
  takeForQueue: () => readonly LangyDraftImage[];
  /** Images handed back to the draft, such as a queued message's when it is edited. */
  restore: (images: readonly LangyDraftImage[]) => void;
  /** Images a send is about to carry, given back to the draft if the send fails. */
  holdAsLastSent: (images: readonly LangyDraftImage[]) => void;
  /** The last send's images, taken to go back in the queue when the draft is taken. */
  takeLastSent: () => readonly LangyDraftImage[];
  restoreLastSent: () => void;
  clear: () => void;
}

function revoke(images: readonly LangyDraftImage[]) {
  for (const image of images) {
    if (image.previewUrl && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(image.previewUrl);
    }
  }
}

export const useLangyComposerImages = defineSlice<LangyComposerImagesState>({
  name: "langy:composer-images",
  create: (set, get) => ({
    images: [],
    lastSent: [],
    add: (image) => set((s) => ({ images: [...s.images, image] })),
    update: (key, change) =>
      set((s) => ({
        images: s.images.map((image) => (image.key === key ? { ...image, ...change } : image)),
      })),
    remove: (keys) => {
      const gone = get().images.filter((image) => keys.includes(image.key));
      if (gone.length === 0) return;
      revoke(gone);
      set((s) => ({ images: s.images.filter((image) => !keys.includes(image.key)) }));
    },
    takeForSend: () => {
      const ready = get().images.filter((image) => image.status === "ready");
      revoke(get().lastSent);
      set({ images: [], lastSent: ready });
      return ready;
    },
    takeForQueue: () => {
      const ready = get().images.filter((image) => image.status === "ready");
      set((s) => ({ images: s.images.filter((image) => image.status !== "ready") }));
      return ready;
    },
    restore: (images) => set((s) => ({ images: [...s.images, ...images] })),
    holdAsLastSent: (images) => {
      const kept = new Set(images.map((image) => image.previewUrl));
      revoke(get().lastSent.filter((image) => !kept.has(image.previewUrl)));
      set({ lastSent: images });
    },
    takeLastSent: () => {
      const taken = get().lastSent;
      set({ lastSent: [] });
      return taken;
    },
    restoreLastSent: () => set((s) => ({ images: [...s.lastSent, ...s.images], lastSent: [] })),
    clear: () => {
      revoke(get().images);
      set({ images: [] });
    },
  }),
});

/** Whether the draft can go: nothing still uploading, nothing failed left in it. */
export function imagesAllowSend(images: readonly LangyDraftImage[]): boolean {
  return images.every((image) => image.status === "ready");
}

/** The file parts a sent message carries for its images. */
export function imageFileParts(images: readonly LangyDraftImage[]) {
  return images.flatMap((image) =>
    image.attachment
      ? [
          {
            type: "file" as const,
            mediaType: image.attachment.mediaType,
            filename: image.attachment.filename,
            url: image.attachment.url,
          },
        ]
      : [],
  );
}
