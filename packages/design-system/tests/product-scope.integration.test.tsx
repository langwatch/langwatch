// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it } from "vitest";

import { ContentTabs } from "../src/components/layout/content-tabs.tsx";
import { ProductScope } from "../src/components/scope/product-scope.tsx";
import { useProductAccent } from "../src/components/scope/use-product-accent.ts";
import { PRODUCT_COLOURS, PRODUCT_NAMES, type ProductName } from "../src/system/product-colours.ts";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

function Reading({ id }: { id: string }) {
  const accent = useProductAccent();
  return (
    <p data-testid={id}>
      {accent.product ?? "none"}|{accent.palette}|{accent.colorPalette}|{accent.roles.fg}
    </p>
  );
}

function PortalReading({ id }: { id: string }) {
  return createPortal(<Reading id={id} />, document.body);
}

describe("ProductScope and useProductAccent", () => {
  /** @scenario "A scope names the product and a hook reads its accent" */
  it("returns each product's palette and role tokens, and the unscoped accent outside a scope", () => {
    renderWithDesignSystem(
      <>
        {PRODUCT_NAMES.map((name) => (
          <ProductScope key={name} product={name}>
            <Reading id={name} />
          </ProductScope>
        ))}
        <Reading id="outside" />
      </>,
    );
    for (const name of PRODUCT_NAMES) {
      expect(screen.getByTestId(name)).toHaveTextContent(
        `${name}|${PRODUCT_COLOURS[name]}|product.${name}|product.${name}.fg`,
      );
    }
    expect(screen.getByTestId("outside")).toHaveTextContent("none|accent|accent|accent.fg");
  });

  /** @scenario "Scopes nest and a null scope resets to the unscoped accent" */
  it("lets the innermost scope win and resets to the unscoped accent for null", () => {
    renderWithDesignSystem(
      <ProductScope product="me">
        <Reading id="outer" />
        <ProductScope product="gateway">
          <Reading id="inner" />
        </ProductScope>
        <ProductScope product={null}>
          <Reading id="reset" />
        </ProductScope>
        <Reading id="after" />
      </ProductScope>,
    );
    expect(screen.getByTestId("outer")).toHaveTextContent("me|blue|product.me|product.me.fg");
    expect(screen.getByTestId("inner")).toHaveTextContent(
      "gateway|accent|product.gateway|product.gateway.fg",
    );
    expect(screen.getByTestId("reset")).toHaveTextContent("none|accent|accent|accent.fg");
    expect(screen.getByTestId("after")).toHaveTextContent("me|blue|product.me|product.me.fg");
  });

  /** @scenario "A portalled surface keeps the product it was opened from" */
  it("reads the scope in a portal that sits outside the page's DOM subtree", () => {
    const { container } = renderWithDesignSystem(
      <ProductScope product="me">
        <PortalReading id="portalled" />
      </ProductScope>,
    );
    const portalled = screen.getByTestId("portalled");
    expect(container).not.toContainElement(portalled);
    expect(portalled).toHaveTextContent("me|blue|product.me|product.me.fg");
  });
});

/** The palette variable a rendered element's generated class points `colorPalette.solid` at. */
function paletteSolidOf(element: Element | null): string | undefined {
  if (!element) return void 0;
  const css = Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
  for (const name of element.classList) {
    const rule = css.match(
      new RegExp(`\\.${name}\\{[^}]*--chakra-colors-color-palette-solid:var\\((--[a-z-]+)\\)`),
    );
    if (rule) return rule[1];
  }
  return void 0;
}

type Pane = "overview" | "people";

function Tabs() {
  const [value, setValue] = useState<Pane>("overview");
  const [typed, setTyped] = useState("");
  return (
    <ContentTabs<Pane>
      label="Sections"
      value={value}
      onValueChange={(next) => setValue(next.value)}
      items={[
        {
          value: "overview",
          label: "Overview",
          content: (
            <input
              aria-label="Draft"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          ),
        },
        { value: "people", label: "People", content: <p>people panel</p> },
      ]}
    />
  );
}

const SCOPES: [string, ProductName | null, string][] = [
  ...PRODUCT_NAMES.map((name): [string, ProductName | null, string] => [
    name,
    name,
    `--chakra-colors-product-${name}-solid`,
  ]),
  ["no product", null, "--chakra-colors-accent-solid"],
];

describe("ContentTabs inside product scopes", () => {
  /** @scenario "Tabs draw the product's accent and keep their behaviour in every scope" */
  it.each(SCOPES)(
    "takes the %s palette and keeps keys, selection and the lazy mount policy",
    async (_label, product, solid) => {
      const user = userEvent.setup();
      const { container } = renderWithDesignSystem(
        <ProductScope product={product}>
          <Tabs />
        </ProductScope>,
      );
      expect(paletteSolidOf(container.querySelector("[data-look]"))).toBe(solid);
      await user.type(screen.getByLabelText("Draft"), "kept");
      await user.click(screen.getByRole("tab", { name: "Overview" }));
      await user.keyboard("{ArrowRight}");
      await waitFor(() => expect(screen.getByRole("tab", { name: "People" })).toHaveFocus());
      expect(screen.getByRole("tab", { name: "People" })).toHaveAttribute("aria-selected", "true");
      await user.keyboard("{ArrowLeft}");
      await waitFor(() => expect(screen.getByRole("tab", { name: "Overview" })).toHaveFocus());
      expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByLabelText("Draft")).toHaveValue("kept");
    },
  );
});
