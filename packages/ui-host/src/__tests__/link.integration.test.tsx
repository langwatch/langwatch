import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BrowserUiDocumentTitle,
  UiCapabilityContextProvider,
  UiNavigationPort,
  UiRoutePort,
  UNAVAILABLE_UI_FEEDBACK,
  UNAVAILABLE_UI_SESSION,
  type UiCapabilities,
  type UiRouteReadingValues,
} from "../capabilities";
import { Link } from "../link";

const navigate = vi.fn<(to: string) => void>();

class RecordingNavigation extends UiNavigationPort {
  navigate(to: string): void {
    navigate(to);
  }

  replace(): void {}

  back(): void {}
}

class EmptyRoute extends UiRoutePort {
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

describe("Link", () => {
  beforeEach(() => navigate.mockClear());

  describe("when capabilities are mounted above it", () => {
    it("renders an anchor and navigates through the port on a plain click", () => {
      render(
        withChakra(
          <UiCapabilityContextProvider value={capabilities}>
            <Link href="/checkout/traces">Traces</Link>
          </UiCapabilityContextProvider>,
        ),
      );

      const anchor = screen.getByRole("link", { name: "Traces" });
      expect(anchor).toHaveAttribute("href", "/checkout/traces");

      anchor.click();

      expect(navigate).toHaveBeenCalledWith("/checkout/traces");
    });

    it("leaves an external address to the browser", () => {
      render(
        withChakra(
          <UiCapabilityContextProvider value={capabilities}>
            <Link href="https://docs.langwatch.ai" isExternal>
              Docs
            </Link>
          </UiCapabilityContextProvider>,
        ),
      );

      const anchor = screen.getByRole("link", { name: "Docs" });
      expect(anchor).toHaveAttribute("target", "_blank");

      anchor.click();

      expect(navigate).not.toHaveBeenCalledWith("https://docs.langwatch.ai");
    });
  });

  describe("when no capabilities are mounted", () => {
    it("leaves the anchor to the browser rather than rendering a dead link", () => {
      render(withChakra(<Link href="/checkout/traces">Traces</Link>));

      const anchor = screen.getByRole("link", { name: "Traces" });
      anchor.click();

      expect(anchor).toHaveAttribute("href", "/checkout/traces");
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});
