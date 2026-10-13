// @vitest-environment jsdom
/** The callable Dialog's optional card ground. */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Dialog } from "../src/components/overlays/dialog.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

/** jsdom resolves no cascade layers, so read the rules a node's classes were given. */
function rulesOf(element: Element): string {
  const css = Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
  return Array.from(element.classList)
    .flatMap((name) => css.match(new RegExp(`\\.${name}[^{]*\\{[^}]*\\}`, "g")) ?? [])
    .join("");
}

function render({ ground }: { ground?: "card" }) {
  renderWithDesignSystem(
    <Dialog open onClose={() => undefined} title="Add model" ground={ground}>
      Body
    </Dialog>,
  );
  return rulesOf(screen.getByRole("dialog"));
}

describe("the Dialog shape's ground", () => {
  /** @scenario "A dialog can keep the card ground it had over a card-toned page" */
  it("draws the card ground when asked", () => {
    expect(render({ ground: "card" })).toContain("--chakra-colors-bg-card");
  });

  /** @scenario "A dialog can keep the card ground it had over a card-toned page" */
  it("keeps the overlay ground otherwise", () => {
    expect(render({})).not.toContain("--chakra-colors-bg-card");
  });
});
