// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PageLayout } from "../src/components/layout/page-layout.tsx";
import { ActionRow } from "../src/components/overlays/action-row.tsx";
import { ProductScope } from "../src/components/scope/product-scope.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

/** The palette variable a rendered element's generated class points `colorPalette.solid` at. */
function paletteSolidOf(element: Element): string | undefined {
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

function Row({ danger = false }: { danger?: boolean }) {
  return (
    <ActionRow
      primaryAction={{ label: "Save", onClick: vi.fn(), danger }}
      secondaryAction={{ label: "Preview", onClick: vi.fn() }}
      destructiveAction={{ label: "Delete", onClick: vi.fn() }}
      cancel={{ onClick: vi.fn() }}
    />
  );
}

const PRIMARY_SOLID = [
  ["Me", "me", "--chakra-colors-product-me-solid"],
  ["LLM Ops", "llm-ops", "--chakra-colors-product-llm-ops-solid"],
  ["Gateway", "gateway", "--chakra-colors-product-gateway-solid"],
  ["Governance", "governance", "--chakra-colors-product-governance-solid"],
  ["no product", null, "--chakra-colors-accent-solid"],
] as const;

describe("primary actions inside product scopes", () => {
  describe("given a footer ActionRow", () => {
    /** @scenario "A primary action draws the product's accent and nothing else changes" */
    it.each(PRIMARY_SOLID)(
      "paints the primary action for %s from the map and leaves Cancel, secondary and destructive alone",
      (_label, product, solid) => {
        renderWithDesignSystem(
          <ProductScope product={product}>
            <Row />
          </ProductScope>,
        );
        expect(paletteSolidOf(screen.getByRole("button", { name: "Save" }))).toBe(solid);
        expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute(
          "data-frame-action",
          "cancel",
        );
        expect(paletteSolidOf(screen.getByRole("button", { name: "Cancel" }))).toBeUndefined();
        expect(paletteSolidOf(screen.getByRole("button", { name: "Preview" }))).toBeUndefined();
        expect(paletteSolidOf(screen.getByRole("button", { name: "Delete" }))).toBe(
          "--chakra-colors-red-solid",
        );
      },
    );

    /** @scenario "A destructive primary stays red in every product" */
    it("keeps a destructive primary red inside a product scope", () => {
      renderWithDesignSystem(
        <ProductScope product="me">
          <Row danger />
        </ProductScope>,
      );
      expect(paletteSolidOf(screen.getByRole("button", { name: "Save" }))).toBe(
        "--chakra-colors-red-solid",
      );
    });
  });

  describe("given a page header", () => {
    /** @scenario "A page header's buttons stay outlined in every product" */
    it.each(PRIMARY_SOLID)(
      "leaves the primary and the plain header button outlined for %s",
      (_label, product) => {
        renderWithDesignSystem(
          <ProductScope product={product}>
            <PageLayout.HeaderButton primary>New</PageLayout.HeaderButton>
            <PageLayout.HeaderButton>Export</PageLayout.HeaderButton>
          </ProductScope>,
        );
        expect(paletteSolidOf(screen.getByRole("button", { name: "New" }))).toBeUndefined();
        expect(paletteSolidOf(screen.getByRole("button", { name: "Export" }))).toBeUndefined();
      },
    );
  });
});
