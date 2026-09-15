/**
 * Client-side avatar image processing: take a user-selected image file,
 * center-crop to square, downscale to fixed size, and encode to data URL.
 */

import { HandledError } from "@langwatch/handled-error";

/** Output avatar edge length in px. Retina-crisp at every size we render. */
export const AVATAR_OUTPUT_SIZE = 256;

/**
 * Max size of the image file a user may pick (8 MB, matching LinkedIn's
 * profile-photo limit). Enforced client-side so the user gets immediate "too
 * large" feedback; the server applies the same ceiling on the (post-resize)
 * payload as a backstop. Kept in sync with AVATAR_MAX_BYTES.
 */
export const AVATAR_MAX_SOURCE_BYTES = 8 * 1024 * 1024;

/**
 * Avatar processing failures. Message is for logs; the registry owns customer-facing copy.
 */
export abstract class AvatarImageError extends HandledError {}

/** Not an image, or the decoder could not make sense of it. */
export class AvatarImageUnreadableError extends AvatarImageError {
  declare readonly code: "avatar_image_unreadable";

  constructor(reason: "not_an_image" | "decode_failed" | "empty") {
    super("avatar_image_unreadable", "Avatar file is not a readable image", {
      meta: { reason },
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "AvatarImageUnreadableError";
  }
}

/** Over {@link AVATAR_MAX_SOURCE_BYTES}. `meta.maxBytes` is the ceiling. */
export class AvatarImageTooLargeError extends AvatarImageError {
  declare readonly code: "avatar_image_too_large";

  constructor(maxBytes: number) {
    super("avatar_image_too_large", "Avatar source file is over the ceiling", {
      meta: { maxBytes },
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "AvatarImageTooLargeError";
  }
}

/**
 * Browser canvas could not process the image. Marked as customer fault
 * because it's a browser quirk, not a platform bug.
 */
export class AvatarImageProcessingFailedError extends AvatarImageError {
  declare readonly code: "avatar_image_processing_failed";

  constructor() {
    super(
      "avatar_image_processing_failed",
      "Browser canvas could not process or encode the avatar",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "AvatarImageProcessingFailedError";
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new AvatarImageUnreadableError("decode_failed"));
    img.src = src;
  });
}

/**
 * Processes a selected file into a square, downscaled data URL.
 *
 * @throws {AvatarImageError} for a non-image, an oversized source file, or a
 *   decode/encoding failure. Render it with `showErrorToast` — the words come
 *   from the code's registry entry, not from `message`.
 */
export async function processAvatarImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new AvatarImageUnreadableError("not_an_image");
  }
  if (file.size > AVATAR_MAX_SOURCE_BYTES) {
    throw new AvatarImageTooLargeError(AVATAR_MAX_SOURCE_BYTES);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);

    // Center-crop to the largest square that fits the source.
    const edge = Math.min(img.naturalWidth, img.naturalHeight);
    if (edge === 0) {
      throw new AvatarImageUnreadableError("empty");
    }
    const sx = (img.naturalWidth - edge) / 2;
    const sy = (img.naturalHeight - edge) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_OUTPUT_SIZE;
    canvas.height = AVATAR_OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new AvatarImageProcessingFailedError();
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, edge, edge, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);

    // Prefer WebP for size; browsers without WebP encoding silently fall back
    // to PNG here, which the server also accepts.
    const dataUrl = canvas.toDataURL("image/webp", 0.9);
    if (!dataUrl.startsWith("data:image/")) {
      throw new AvatarImageProcessingFailedError();
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
