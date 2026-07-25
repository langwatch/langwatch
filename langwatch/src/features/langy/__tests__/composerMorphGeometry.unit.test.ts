/**
 * @vitest-environment jsdom
 *
 * The geometry the home page's send depends on, and in particular the one
 * hazard that would silently ruin it: measuring the panel's composer while the
 * panel is still closed, and so landing the travelling copy wherever the closed
 * transform happens to have put it.
 *
 * Spec: specs/home/langy-home-morph.feature
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  glowRectFor,
  midpointRect,
  type MorphRect,
  PANEL_ROOT_ATTR,
  readRectAtRest,
} from "../logic/composerMorphGeometry";

const ORIGIN: MorphRect = { top: 100, left: 40, width: 720, height: 46 };
const DESTINATION: MorphRect = { top: 700, left: 1040, width: 364, height: 40 };

afterEach(() => {
  document.body.innerHTML = "";
});

describe("glowRectFor", () => {
  /**
   * The travelling light is DERIVED from the bar, not taken from the block:
   * a rect the ghost paints a cheap radial copy into. The block's own moving
   * canvas is never consulted, so it cannot be moved.
   */
  /** @scenario The block's light stays where it is */
  it("keeps the warm mass centred on the bar it rides behind", () => {
    const glow = glowRectFor(ORIGIN);

    expect(glow.left + glow.width / 2).toBe(ORIGIN.left + ORIGIN.width / 2);
    expect(glow.top + glow.height / 2).toBe(ORIGIN.top + ORIGIN.height / 2);
  });

  it("overhangs the bar, so the light is never a rectangle", () => {
    const glow = glowRectFor(ORIGIN);

    expect(glow.width).toBeGreaterThan(ORIGIN.width);
    expect(glow.height).toBeGreaterThan(ORIGIN.height);
  });
});

describe("midpointRect", () => {
  it("sits halfway along every edge of the journey", () => {
    expect(midpointRect(ORIGIN, DESTINATION)).toEqual({
      top: 400,
      left: 540,
      width: 542,
      height: 43,
    });
  });
});

describe("readRectAtRest", () => {
  /**
   * jsdom has no layout, so `getBoundingClientRect` is stubbed on the element
   * itself and made to answer differently depending on whether its panel is
   * still wearing the closed transform. That is exactly the real behaviour
   * being guarded: a browser returns the TRANSFORMED box, so reading through a
   * closed panel describes somewhere the composer will never be.
   */
  const mountPanel = ({ closedOffset }: { closedOffset: number }) => {
    const panel = document.createElement("div");
    panel.setAttribute(PANEL_ROOT_ATTR, "");
    panel.style.transform = `translateX(${closedOffset}px)`;

    const composer = document.createElement("div");
    panel.appendChild(composer);
    document.body.appendChild(panel);

    composer.getBoundingClientRect = () => {
      const shifted = panel.style.transform !== "none";
      return {
        top: DESTINATION.top,
        left: DESTINATION.left + (shifted ? closedOffset : 0),
        width: DESTINATION.width,
        height: DESTINATION.height,
      } as DOMRect;
    };

    return { panel, composer };
  };

  describe("given the panel is still closed", () => {
    /** @scenario The composer travels to the docked panel */
    it("reads the resting box, not the one the closed transform describes", () => {
      const { composer } = mountPanel({ closedOffset: 392 });

      expect(readRectAtRest(composer)).toEqual(DESTINATION);
      // Reading it naively is the bug this exists to avoid.
      expect(composer.getBoundingClientRect().left).toBe(
        DESTINATION.left + 392,
      );
    });

    it("puts the panel's own transform back, so framer keeps driving it", () => {
      const { panel, composer } = mountPanel({ closedOffset: 392 });

      readRectAtRest(composer);

      expect(panel.style.transform).toBe("translateX(392px)");
    });
  });

  describe("given the element is not inside a panel at all", () => {
    it("reads it where it stands", () => {
      const loose = document.createElement("div");
      loose.getBoundingClientRect = () => ORIGIN as DOMRect;
      document.body.appendChild(loose);

      expect(readRectAtRest(loose)).toEqual(ORIGIN);
    });
  });
});
