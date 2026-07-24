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

/** Output avatar edge length in px. Retina-crisp at every size we render. */
export const AVATAR_OUTPUT_SIZE = 256;

/**
 * Max size of the image file a user may pick (8 MB, matching LinkedIn's
 * profile-photo limit). Enforced client-side so the user gets immediate "too
 * large" feedback; the server applies the same ceiling on the (post-resize)
 * payload as a backstop. Kept in sync with AVATAR_MAX_BYTES.
 */
export const AVATAR_MAX_SOURCE_BYTES = 8 * 1024 * 1024;

export class AvatarImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvatarImageError";
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new AvatarImageError("That file could not be read as an image."));
    img.src = src;
  });
}

/**
 * Processes a selected file into a square, downscaled data URL.
 *
 * @throws {AvatarImageError} for a non-image, an oversized source file, or a
 *   decode/encoding failure — messages are safe to show to the user.
 */
export async function processAvatarImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new AvatarImageError("Please choose an image file.");
  }
  if (file.size > AVATAR_MAX_SOURCE_BYTES) {
    throw new AvatarImageError(
      `Image is too large (max ${Math.round(AVATAR_MAX_SOURCE_BYTES / 1024 / 1024)} MB).`,
    );
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);

    // Center-crop to the largest square that fits the source.
    const edge = Math.min(img.naturalWidth, img.naturalHeight);
    if (edge === 0) {
      throw new AvatarImageError("That image appears to be empty.");
    }
    const sx = (img.naturalWidth - edge) / 2;
    const sy = (img.naturalHeight - edge) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_OUTPUT_SIZE;
    canvas.height = AVATAR_OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new AvatarImageError("Your browser could not process the image.");
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
      throw new AvatarImageError("Could not encode the image.");
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
