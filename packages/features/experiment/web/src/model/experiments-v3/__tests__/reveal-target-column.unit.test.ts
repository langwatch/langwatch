/**
 * @vitest-environment jsdom
 *
 * A column Langy adds lands past the right edge of a wide workbench, so
 * without this the reader watched a saved, real change happen off screen and
 * read the whole step as nothing happening.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { revealTargetColumn } from "../reveal-target-column";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function plantColumn(targetId: string) {
  const header = document.createElement("div");
  header.setAttribute("data-target-column", targetId);
  const scrollIntoView = vi.fn();
  // jsdom has no layout, so the method does not exist to spy on.
  (header as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoView;
  document.body.append(header);
  return scrollIntoView;
}

/** Drain the frames the helper waits on for a column that has not painted. */
async function runFrames(count: number) {
  for (let i = 0; i < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("revealTargetColumn", () => {
  describe("given the column is on the page", () => {
    it("scrolls it into view sideways, leaving the rows where they were", () => {
      const scrollIntoView = plantColumn("target-new");

      revealTargetColumn("target-new");

      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    });

    it("scrolls the column asked for and no other", () => {
      const wanted = plantColumn("target-new");
      const other = plantColumn("target-baseline");

      revealTargetColumn("target-new");

      expect(wanted).toHaveBeenCalledTimes(1);
      expect(other).not.toHaveBeenCalled();
    });
  });

  describe("given the column has not painted yet", () => {
    it("waits for it rather than giving up on the first look", async () => {
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
        setTimeout(() => callback(0), 0),
      );

      revealTargetColumn("target-late");
      const scrollIntoView = plantColumn("target-late");
      await runFrames(3);

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it("stops looking instead of spinning forever", async () => {
      const frame = vi.fn((callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
      vi.stubGlobal("requestAnimationFrame", frame);

      revealTargetColumn("target-never");
      await runFrames(40);

      // Exactly the ceiling, from both sides. An upper bound alone would also
      // pass for a version that gave up after the first look, which is the
      // other way this can break and the one that loses the scroll.
      expect(frame).toHaveBeenCalledTimes(10);
    });
  });
});
