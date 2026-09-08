/**
 * The address a dataset cell renders as a picture, or nothing.
 *
 * Read by the result tables, which show a dataset value with no column type
 * behind it. An uploaded picture is a reference relative to this origin, which
 * `getImageUrl` does not recognize, so it is read here, and only when the
 * reference names a picture: without the column type, a reference to a
 * document would otherwise be drawn as a broken image.
 *
 * A cell holds whatever the row holds, so a number, a list or an object
 * reaches here too and answers with nothing.
 *
 * The grid does not use this: `AttachmentCell` gets the column type and reads
 * that instead.
 */
import { getImageUrl } from "~/components/ExternalImage";
import { isImageAttachmentRef } from "~/shared/datasets/attachment-ref";

export const cellPictureUrl = (value: unknown): string | null => {
  const fromUrl = getImageUrl(value);
  if (fromUrl) return fromUrl;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isImageAttachmentRef(trimmed) ? trimmed : null;
};
