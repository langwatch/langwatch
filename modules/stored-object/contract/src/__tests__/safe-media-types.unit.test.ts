import { describe, expect, it } from "vitest";

import { isReadbackSafe } from "../safe-media-types.ts";

describe("isReadbackSafe", () => {
  it.each(["image/png", "image/webp", "audio/mpeg", "video/mp4", "application/pdf"])(
    "serves %s as it is",
    (mediaType) => {
      expect(isReadbackSafe(mediaType)).toBe(true);
    },
  );

  it.each(["image/svg+xml", "image/svg+xml; charset=utf-8", "IMAGE/SVG+XML", "text/html"])(
    "downgrades a type a browser can run as a page: %s",
    (mediaType) => {
      expect(isReadbackSafe(mediaType)).toBe(false);
    },
  );
});
