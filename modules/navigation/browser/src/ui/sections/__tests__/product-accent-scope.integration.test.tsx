/**
 * @vitest-environment jsdom
 * Spec: modules/navigation/specs/product-switcher-navigation.feature
 */

import {
  UiHostServicesContextProvider,
  type UiHostServices,
} from "@langwatch/browser-host/capabilities";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { useProductAccent } from "@langwatch/design-system/use-product-accent";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it } from "vitest";

import { ProductAccentScope } from "../product-accent-scope.tsx";

afterEach(cleanup);

function servicesAt(pathname: string | undefined): UiHostServices {
  return createUiHostServicesFromHost({
    route: () => ({ params: {}, query: {}, pathname }),
    navigate: () => void 0,
  });
}

function Reading({ id }: { id: string }) {
  const accent = useProductAccent();
  return (
    <p data-testid={id}>
      {accent.product ?? "none"}|{accent.colorPalette}
    </p>
  );
}

function Draft() {
  const [typed, setTyped] = useState("");
  return (
    <input aria-label="Draft" value={typed} onChange={(event) => setTyped(event.target.value)} />
  );
}

function PortalReading({ id }: { id: string }) {
  return createPortal(<Reading id={id} />, document.body);
}

function At({ pathname, children }: { pathname: string | undefined; children: ReactNode }) {
  return (
    <UiHostServicesContextProvider value={servicesAt(pathname)}>
      <ProductAccentScope>{children}</ProductAccentScope>
    </UiHostServicesContextProvider>
  );
}

describe("ProductAccentScope", () => {
  describe("given the route the host services read", () => {
    /** @scenario "The address in view names the product whose accent every surface reads" */
    it.each([
      ["/me", "me|product.me"],
      ["/me/configure", "me|product.me"],
      ["/demo/traces", "llm-ops|product.llm-ops"],
      ["/gateway/virtual-keys", "gateway|product.gateway"],
      ["/governance", "governance|product.governance"],
    ])("reads %s as %s", (pathname, expected) => {
      renderWithDesignSystem(
        <At pathname={pathname}>
          <Reading id="page" />
        </At>,
      );
      expect(screen.getByTestId("page")).toHaveTextContent(expected);
    });

    /** @scenario "Settings, ops and an unreadable address reset to the unscoped accent" */
    it.each([["/settings/members"], ["/ops/organizations"], ["/"], [""], [void 0]])(
      "leaves %s unscoped rather than inheriting a product",
      (pathname) => {
        renderWithDesignSystem(
          <At pathname={pathname}>
            <Reading id="page" />
          </At>,
        );
        expect(screen.getByTestId("page")).toHaveTextContent("none|accent");
      },
    );
  });

  describe("given a portalled surface opened from the page", () => {
    /** @scenario "A page, the open drawer and a portalled menu read the same accent" */
    it("reads the page's product outside the page's DOM subtree", () => {
      const { container } = renderWithDesignSystem(
        <At pathname="/me">
          <Reading id="page" />
          <PortalReading id="portal" />
        </At>,
      );
      expect(container).not.toContainElement(screen.getByTestId("portal"));
      expect(screen.getByTestId("portal")).toHaveTextContent("me|product.me");
      expect(screen.getByTestId("page")).toHaveTextContent("me|product.me");
    });
  });

  describe("given the reader moves from one product to another", () => {
    /** @scenario "Changing product keeps the page's draft input" */
    it("changes the accent and keeps the typed draft on the same input", async () => {
      const user = userEvent.setup();
      const view = renderWithDesignSystem(
        <At pathname="/me">
          <Reading id="page" />
          <Draft />
        </At>,
      );
      await user.type(screen.getByLabelText("Draft"), "kept");
      const input = screen.getByLabelText("Draft");

      view.rerender(
        <At pathname="/gateway/virtual-keys">
          <Reading id="page" />
          <Draft />
        </At>,
      );

      expect(screen.getByTestId("page")).toHaveTextContent("gateway|product.gateway");
      expect(screen.getByLabelText("Draft")).toBe(input);
      expect(screen.getByLabelText("Draft")).toHaveValue("kept");
    });
  });
});
