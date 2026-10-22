// @vitest-environment jsdom

/** The Instant Evals decision providers and LangWatch's hosted models draw their own brand marks,
 * not the generic Custom glyph a provider without a mark falls back to. */
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  inferProvider,
  ProviderIconGlyph,
  type ProviderKey,
} from "../src/components/scope/provider-icons.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

function artworkOf(provider: ProviderKey): string {
  const { container, unmount } = renderWithDesignSystem(
    <ProviderIconGlyph provider={provider} size="16px" />,
  );
  const paths = [...container.querySelectorAll("svg path")].map((p) => p.getAttribute("d"));
  unmount();
  return paths.join("|");
}

describe("provider icons", () => {
  describe("given LangWatch's hosted decision model id", () => {
    it("names LangWatch as the provider", () => {
      expect(inferProvider("langwatch/instant-evals")).toBe("langwatch");
    });

    it("draws the LangWatch mark", () => {
      expect(artworkOf("langwatch")).not.toBe("");
    });
  });

  describe("given the decision model providers", () => {
    it.each(["inception", "perplexity", "cloudflare", "langwatch"] as const)(
      "draws a %s mark of its own rather than the Custom glyph",
      (provider) => {
        expect(artworkOf(provider)).not.toBe(artworkOf("custom"));
      },
    );
  });
});
