// @vitest-environment jsdom
/**
 * The expandable image opens a lightbox over the page: a fixed, full-viewport
 * backdrop plus the enlarged image on top of it.
 *
 * A lightbox is the surface where Escape is most strongly expected, and the
 * cost of ignoring it is not just the missed keystroke. The backdrop stays in
 * the DOM swallowing every pointer event, so the page underneath looks
 * dismissed and is not, and stays that way until the reader happens to click
 * the backdrop itself.
 *
 * `getImageUrl`'s own tests live in `ExternalImage.test.ts` next to this file.
 * That file is pure logic and stays a unit test; this one renders the
 * component, so it is an integration test.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ExternalImage } from "../ExternalImage";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(() => {
  cleanup();
});

const ALT_TEXT = "Revenue by region";
const BACKDROP = "expanded-image-backdrop";

describe("an expandable image in a results cell", () => {
  /** Renders the thumbnail and clicks it to open the lightbox. */
  const openLightbox = async () => {
    const user = userEvent.setup();

    render(
      <ExternalImage
        alt={ALT_TEXT}
        src="https://example.com/chart.png"
        expandable
      />,
      { wrapper: Wrapper },
    );

    await user.click(screen.getByAltText(ALT_TEXT));

    return user;
  };

  describe("given the reader has opened it over the page", () => {
    describe("when Escape is pressed", () => {
      it("takes the backdrop out of the page along with the lightbox", async () => {
        const user = await openLightbox();
        expect(screen.getByTestId(BACKDROP)).toBeDefined();

        await user.keyboard("{Escape}");

        expect(screen.queryByTestId(BACKDROP)).toBeNull();
      });
    });

    describe("when the backdrop is clicked", () => {
      it("takes the backdrop out of the page along with the lightbox", async () => {
        const user = await openLightbox();

        await user.click(screen.getByTestId(BACKDROP));

        expect(screen.queryByTestId(BACKDROP)).toBeNull();
      });
    });
  });
});
