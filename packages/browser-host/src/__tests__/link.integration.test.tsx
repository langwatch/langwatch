import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BrowserUiDocumentTitle,
  UiCapabilityContextProvider,
  UiNavigation,
  UiRoute,
  UNAVAILABLE_UI_FEEDBACK,
  UNAVAILABLE_UI_SESSION,
  type UiCapabilities,
  type UiRouteReadingValues,
} from "../capabilities.ts";
import { Link } from "../link.tsx";

const navigate = vi.fn<(to: string) => void>();

class RecordingNavigation extends UiNavigation {
  navigate(to: string): void {
    navigate(to);
  }

  replace(): void {}

  back(): void {}
}

class EmptyRoute extends UiRoute {
  reading(): UiRouteReadingValues {
    return { params: {}, query: {} };
  }

  setQuery(): void {}
}

const capabilities: UiCapabilities = {
  documentTitle: BrowserUiDocumentTitle.create(),
  feedback: UNAVAILABLE_UI_FEEDBACK,
  navigation: new RecordingNavigation(),
  route: new EmptyRoute(),
  session: UNAVAILABLE_UI_SESSION,
};

function withChakra(children: ReactNode) {
  return <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>;
}

function mounted(link: ReactNode) {
  render(
    withChakra(
      <UiCapabilityContextProvider value={capabilities}>{link}</UiCapabilityContextProvider>,
    ),
  );
}

describe("Link", () => {
  beforeEach(() => navigate.mockClear());

  describe("when capabilities are mounted above it", () => {
    /** @scenario "A plain click on an in-app link routes through the navigation capability" */
    it("routes a plain click through the navigation capability and prevents the document load", () => {
      mounted(<Link href="/checkout/traces">Traces</Link>);

      const anchor = screen.getByRole("link", { name: "Traces" });
      expect(anchor).toHaveAttribute("href", "/checkout/traces");

      const followed = fireEvent.click(anchor);

      expect(navigate).toHaveBeenCalledWith("/checkout/traces");
      expect(followed).toBe(false);
    });

    /** @scenario "A link to the API's own address is a document load" */
    it("leaves an API address to the browser", () => {
      mounted(<Link href="/api/auth/logout">Sign out</Link>);

      const followed = fireEvent.click(screen.getByRole("link", { name: "Sign out" }));

      expect(navigate).not.toHaveBeenCalled();
      expect(followed).toBe(true);
    });

    describe("when the click is the browser's to handle", () => {
      /** @scenario "A modified click, a new tab or a download stays the browser's" */
      it("leaves a modified click, a new tab and a download alone", () => {
        mounted(
          <>
            <Link href="/checkout/traces">Traces</Link>
            <Link href="/checkout/datasets" target="_blank">
              Datasets
            </Link>
            <Link href="/checkout/export.csv" download>
              Export
            </Link>
          </>,
        );

        fireEvent.click(screen.getByRole("link", { name: "Traces" }), { metaKey: true });
        fireEvent.click(screen.getByRole("link", { name: "Datasets" }));
        fireEvent.click(screen.getByRole("link", { name: "Export" }));

        expect(navigate).not.toHaveBeenCalled();
      });
    });

    /** @scenario "An external link opens a new tab" */
    it("opens an external address in a new tab without an opener", () => {
      mounted(
        <Link href="https://docs.langwatch.ai" isExternal>
          Docs
        </Link>,
      );

      const anchor = screen.getByRole("link", { name: "Docs" });
      expect(anchor).toHaveAttribute("target", "_blank");
      expect(anchor).toHaveAttribute("rel", "noopener noreferrer");

      fireEvent.click(anchor);

      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe("when no capabilities are mounted", () => {
    /** @scenario "A link with no shell above it is left to the browser" */
    it("leaves the anchor to the browser rather than rendering a dead link", () => {
      render(withChakra(<Link href="/checkout/traces">Traces</Link>));

      const anchor = screen.getByRole("link", { name: "Traces" });
      const followed = fireEvent.click(anchor);

      expect(anchor).toHaveAttribute("href", "/checkout/traces");
      expect(followed).toBe(true);
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});
