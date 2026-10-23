// @vitest-environment jsdom

/** The Instant Evals decision providers and LangWatch's hosted models draw their own brand marks,
 * not the generic Custom glyph a provider without a mark falls back to. */
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LOGO_LINES_PATH, LOGO_PLATE_PATH } from "../src/components/brand/logo-paths.ts";
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
  });

  describe("given the decision model providers", () => {
    /** @scenario Each decision model provider draws its own brand mark */
    it("draws the LangWatch logo and a mark of each one's own rather than the Custom glyph", () => {
      const providers = ["inception", "perplexity", "cloudflare", "langwatch"] as const;
      const drawings = [...providers, "custom" as const].map(artworkOf);

      expect(artworkOf("langwatch")).toBe([LOGO_PLATE_PATH, LOGO_LINES_PATH].join("|"));
      expect(new Set(drawings).size).toBe(providers.length + 1);
    });
  });
});
