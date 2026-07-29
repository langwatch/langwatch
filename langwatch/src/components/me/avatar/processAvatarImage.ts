/**
 * Client-side avatar image processing: take a user-selected image file,
 * center-crop it to a square, downscale to a small fixed size, and re-encode
 * to a compact data URL ready to POST to `user.setAvatar`.
 *
 * Doing the crop/resize in the browser keeps the uploaded payload tiny (a few
 * KB) regardless of the source photo's resolution, so the server never has to
 * process a full-resolution image and the stored object stays small.
 *
 * Spec: specs/settings/user-avatar.feature
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
 * The avatar processing failures, as handled errors.
 *
 * These never cross a network boundary — the whole crop/resize runs in the
 * browser — but they are handled errors all the same, because the reason this
 * codebase types a failure is the same either way: the cause is known, the
 * user can act on it, and the words they read belong in the code-keyed
 * registry rather than at the throw site (ADR-045).
 *
 * Three codes, because they ask for three different things: pick a real image,
 * pick a smaller one, or try elsewhere. `message` stays server-style — short,
 * for a log line — and never reaches the screen; `presentation.ts` owns the
 * copy.
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
 * The browser's canvas could not process or encode the image. Not the file's
 * fault and not something a different file reliably fixes, so it gets its own
 * code and its own advice.
 *
 * `fault: "customer"` — not because anyone did anything wrong, but because
 * `fault` names who can act, and it is what decides whether a failure logs as
 * routine or pages someone. This whole function runs inside the visitor's own
 * browser; a canvas that will not hand back a 2d context is that browser's
 * quirk, and no deploy of ours changes it. Booking it as `platform` filed a
 * browser quirk as a platform incident.
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
    ctx.drawImage(
      img,
      sx,
      sy,
      edge,
      edge,
      0,
      0,
      AVATAR_OUTPUT_SIZE,
      AVATAR_OUTPUT_SIZE,
    );

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
