/**
 * The image format a file's leading bytes name, so a file is sent to the model as an image only
 * when its bytes are one. Spec: modules/langy/specs/langy-image-attachments.feature
 */
import type { LangyAttachmentMediaType } from "@langwatch/langy-contract";

/** How many leading bytes are enough to tell the formats apart. */
export const LANGY_IMAGE_SNIFF_BYTES = 12;

const ascii = (text: string): readonly number[] => Array.from(new TextEncoder().encode(text));

/** Each format with the byte runs it must start with, as `[offset, bytes]` pairs. */
const SIGNATURES: readonly (readonly [
  LangyAttachmentMediaType,
  readonly (readonly [number, readonly number[]])[],
])[] = [
  ["image/png", [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]]],
  ["image/jpeg", [[0, [0xff, 0xd8, 0xff]]]],
  ["image/gif", [[0, ascii("GIF87a")]]],
  ["image/gif", [[0, ascii("GIF89a")]]],
  [
    "image/webp",
    [
      [0, ascii("RIFF")],
      [8, ascii("WEBP")],
    ],
  ],
];

function holdsRun({
  bytes,
  offset,
  run,
}: {
  bytes: Uint8Array;
  offset: number;
  run: readonly number[];
}): boolean {
  return run.every((byte, index) => bytes[offset + index] === byte);
}

/** The format the bytes start with, or `not_an_image` when none of Langy's formats matches. */
export function langyImageMediaTypeOfBytes(
  bytes: Uint8Array,
): LangyAttachmentMediaType | "not_an_image" {
  const match = SIGNATURES.find(([, runs]) =>
    runs.every(([offset, run]) => holdsRun({ bytes, offset, run })),
  );
  return match ? match[0] : "not_an_image";
}
