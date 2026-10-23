/**
 * A surface that opens over the page's overlays holds Langy's panel above them until it lets go.
 * @see specs/langy/langy-studio-code-blocks.feature
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useLangyStore } from "../langy.store.ts";

beforeEach(() => {
  useLangyStore.setState({ aboveHolds: 0 });
});

describe("given two surfaces holding Langy above", () => {
  describe("when one releases", () => {
    /** @scenario "Langy rides above Studio's node drawer while the code editor is open" */
    it("stays above until the last release, and a second release of the same hold is harmless", () => {
      const first = useLangyStore.getState().holdAbove();
      const second = useLangyStore.getState().holdAbove();

      first();
      first();
      expect(useLangyStore.getState().aboveHolds).toBe(1);

      second();
      expect(useLangyStore.getState().aboveHolds).toBe(0);
    });
  });
});
