import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_SOCIAL_CARD, socialCardPath } from "../../features/discovery/compile.ts";
import { renderSocialCards, type CardCapture } from "../social-card-images.ts";

let cacheDir = "";

beforeEach(() => {
  cacheDir = mkdtempSync(path.join(os.tmpdir(), "docs-social-cards-"));
});
afterEach(() => rmSync(cacheDir, { recursive: true, force: true }));

/** A drawer that paints a flat PNG and counts how often it was opened and asked to draw. */
function countingDrawer() {
  const calls = { opened: 0, drawn: 0, closed: 0 };
  const open = async (): Promise<CardCapture> => {
    calls.opened += 1;
    return {
      capture: async () => {
        calls.drawn += 1;
        return sharp({
          create: { width: 1200, height: 630, channels: 3, background: "#e17100" },
        })
          .png()
          .toBuffer();
      },
      close: async () => {
        calls.closed += 1;
      },
    };
  };
  return { calls, open };
}

describe("when the build publishes the social cards", () => {
  const cards = [DEFAULT_SOCIAL_CARD];
  const name = socialCardPath({ card: DEFAULT_SOCIAL_CARD }).slice(1);

  /** @scenario "A shared link shows the card of the section it points into" */
  it("draws a card on a cache miss and serves the next build from disk", async () => {
    const first = countingDrawer();
    const drawn = await renderSocialCards({ cards, cacheDir, open: first.open });
    expect([...drawn.keys()]).toEqual([name]);
    expect((await sharp(drawn.get(name)).metadata()).format).toBe("webp");
    expect(first.calls).toEqual({ opened: 1, drawn: 1, closed: 1 });

    const second = countingDrawer();
    const reused = await renderSocialCards({ cards, cacheDir, open: second.open });
    expect(Buffer.from(reused.get(name) ?? [])).toEqual(Buffer.from(drawn.get(name) ?? []));
    expect(second.calls.opened).toBe(0);
    expect(readdirSync(cacheDir).filter((file) => file.endsWith(".partial"))).toEqual([]);
  });

  /** @scenario "A shared link shows the card of the section it points into" */
  it("draws a card again when its cache entry no longer decodes", async () => {
    writeFileSync(path.join(cacheDir, path.basename(name)), "not an image");
    const drawer = countingDrawer();
    const files = await renderSocialCards({ cards, cacheDir, open: drawer.open });
    expect(drawer.calls.drawn).toBe(1);
    expect((await sharp(files.get(name)).metadata()).format).toBe("webp");
  });
});
