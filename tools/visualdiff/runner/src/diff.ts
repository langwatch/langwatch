import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface PixelDiff {
  ratio: number;
  pixels: number;
  width: number;
  height: number;
  sizeMismatch: boolean;
}

/**
 * Different heights are compared on the union canvas, padded white, not
 * cropped: cropping to the shorter one hides the section that was added.
 */
export const diffScreenshots = ({
  base,
  candidate,
  out,
}: {
  base: string;
  candidate: string;
  out: string;
}): PixelDiff | null => {
  if (!existsSync(base) || !existsSync(candidate)) return null;
  const first = PNG.sync.read(readFileSync(base));
  const second = PNG.sync.read(readFileSync(candidate));
  const width = Math.max(first.width, second.width);
  const height = Math.max(first.height, second.height);
  const padded = (image: PNG): PNG => {
    if (image.width === width && image.height === height) return image;
    const canvas = new PNG({ width, height });
    canvas.data.fill(255);
    PNG.bitblt(image, canvas, 0, 0, image.width, image.height, 0, 0);
    return canvas;
  };
  const output = new PNG({ width, height });
  const changed = pixelmatch(padded(first).data, padded(second).data, output.data, width, height, {
    threshold: 0.1,
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, PNG.sync.write(output));
  return {
    ratio: changed / (width * height),
    pixels: changed,
    width,
    height,
    sizeMismatch: first.width !== second.width || first.height !== second.height,
  };
};
