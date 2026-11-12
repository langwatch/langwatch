import { closeSync, openSync, readSync } from "node:fs";

export type ImageSize = { width: number; height: number };

const HEADER_BYTES = 256 * 1024;
const sizes = new Map<string, ImageSize | null>();

function pngSize({ bytes }: { bytes: Buffer }): ImageSize | null {
  if (bytes.length < 24 || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function gifSize({ bytes }: { bytes: Buffer }): ImageSize | null {
  if (bytes.length < 10) return null;
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

function webpSize({ bytes }: { bytes: Buffer }): ImageSize | null {
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X" && bytes.length >= 30)
    return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  if (chunk === "VP8 " && bytes.length >= 30)
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L" && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** Walks JPEG segments to the first start-of-frame marker, which carries the dimensions. */
function jpegSize({ bytes }: { bytes: Buffer }): ImageSize | null {
  let offset = 2;
  while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1] ?? 0;
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    offset += 2 + length;
  }
  return null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function formatOf({ bytes }: { bytes: Buffer }) {
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
  if (bytes.toString("ascii", 0, 3) === "GIF") return "gif";
  const riff = bytes.toString("ascii", 0, 4) === "RIFF";
  if (riff && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  return null;
}

const READERS = { png: pngSize, gif: gifSize, webp: webpSize, jpeg: jpegSize };

function sizeOf({ bytes }: { bytes: Buffer }): ImageSize | null {
  const format = formatOf({ bytes });
  return format ? READERS[format]({ bytes }) : null;
}

/** A raster image's intrinsic pixel size from its header; null for vectors and LFS pointers. */
export function readImageSize({ file }: { file: string }): ImageSize | null {
  if (sizes.has(file)) return sizes.get(file) ?? null;
  let size: ImageSize | null = null;
  try {
    const handle = openSync(file, "r");
    try {
      const bytes = Buffer.alloc(HEADER_BYTES);
      const read = readSync(handle, bytes, 0, HEADER_BYTES, 0);
      size = sizeOf({ bytes: bytes.subarray(0, read) });
    } finally {
      closeSync(handle);
    }
  } catch {
    size = null;
  }
  if (size && (size.width <= 0 || size.height <= 0)) size = null;
  sizes.set(file, size);
  return size;
}
