/**
 * @see modules/langy/specs/langy-image-attachments.feature
 */
import { describe, expect, it } from "vitest";

import { langyImageMediaTypeOfBytes } from "../langy-image-bytes.rules.ts";

const bytes = (...values: (number | string)[]) =>
  Uint8Array.from(
    values.flatMap((value) =>
      typeof value === "string" ? Array.from(new TextEncoder().encode(value)) : [value],
    ),
  );

describe("langyImageMediaTypeOfBytes", () => {
  /** @scenario A file whose bytes are not the image it claims is refused when it is confirmed */
  it.each([
    ["image/png", bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0)],
    ["image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0)],
    ["image/gif", bytes("GIF89a")],
    ["image/gif", bytes("GIF87a")],
    ["image/webp", bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 ")],
  ])("names %s from its leading bytes", (mediaType, head) => {
    expect(langyImageMediaTypeOfBytes(head)).toBe(mediaType);
  });

  /** @scenario A file whose bytes are not the image it claims is refused when it is confirmed */
  it("answers not_an_image for text or a RIFF file that is not WebP", () => {
    expect(langyImageMediaTypeOfBytes(bytes("hello, not an image"))).toBe("not_an_image");
    expect(langyImageMediaTypeOfBytes(bytes("RIFF", 0, 0, 0, 0, "WAVEfmt "))).toBe("not_an_image");
    expect(langyImageMediaTypeOfBytes(new Uint8Array())).toBe("not_an_image");
  });
});
