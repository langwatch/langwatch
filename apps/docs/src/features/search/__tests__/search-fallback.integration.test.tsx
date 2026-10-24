// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { SearchFallback } from "../browser/search-fallback.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  act(() => createRoot(host).render(node));
  return host;
}

function Broken(): never {
  throw new Error("render failed");
}

describe("when rendering the search results throws", () => {
  /** @scenario "Explain a search that fails to render" */
  it("shows the fallback message in place of the results", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = render(
      <SearchFallback>
        <Broken />
      </SearchFallback>,
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/Search stopped working/);
    quiet.mockRestore();
  });

  /** @scenario "Explain a search that fails to render" */
  it("renders its children while nothing fails", () => {
    const host = render(
      <SearchFallback>
        <span>results</span>
      </SearchFallback>,
    );
    expect(host.textContent).toBe("results");
  });
});
