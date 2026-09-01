// @vitest-environment jsdom

/**
 * The vendor marks and the wrapper that renders them. Every mark is a plain
 * inline SVG, so what is worth pinning is that each one draws something of its
 * own — a copy-paste slip during a move shows up as two names drawing the same
 * artwork.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AnthropicIcon,
  AWSIcon,
  CustomIcon,
  DatabricksIcon,
  EqualsIcon,
  GitHubIcon,
  IconGlyph,
  LLMIcon,
  MicrosoftIcon,
  OpenAIIcon,
  OpenTelemetryIcon,
  WeaviateIcon,
  WorkatoIcon,
} from "../src/components/icons";
import { renderWithDesignSystem } from "../src/testing";

afterEach(() => cleanup());

const MARKS = {
  AnthropicIcon,
  AWSIcon,
  CustomIcon,
  DatabricksIcon,
  EqualsIcon,
  GitHubIcon,
  LLMIcon,
  MicrosoftIcon,
  OpenAIIcon,
  OpenTelemetryIcon,
  WeaviateIcon,
  WorkatoIcon,
} as const;

describe("icons", () => {
  describe("given every mark the barrel exports", () => {
    it("draws a scalable mark for each one", () => {
      const drawn = Object.entries(MARKS).map(([name, Mark]) => {
        const { container, unmount } = render(<Mark />);
        const svg = container.querySelector("svg");
        const shapes = svg?.querySelectorAll("path, rect, polyline, line").length ?? 0;
        const viewBox = svg?.getAttribute("viewBox") ?? null;
        unmount();
        return { name, viewBox, shapes };
      });

      expect(drawn.filter((mark) => mark.viewBox === null)).toEqual([]);
      expect(drawn.filter((mark) => mark.shapes === 0)).toEqual([]);
    });

    it("gives each name artwork of its own", () => {
      const drawings = Object.entries(MARKS).map(([name, Mark]) => {
        const { container, unmount } = render(<Mark />);
        const markup = container.innerHTML;
        unmount();
        return [name, markup] as const;
      });

      expect(new Set(drawings.map(([, markup]) => markup)).size).toBe(drawings.length);
    });
  });

  describe("given a mark that takes a size", () => {
    it("draws it at the size the caller asked for", () => {
      const { container } = render(<GitHubIcon size={48} />);
      const svg = container.querySelector("svg");

      expect(svg?.getAttribute("width")).toBe("48");
      expect(svg?.getAttribute("height")).toBe("48");
    });
  });
});

/**
 * The glyph wrapper takes only the mark, a size and the monochrome flag, so a
 * test cannot label it. It is found by the `aria-hidden` it sets, and its
 * styling is read back from the rules its generated class names.
 */
const glyphsIn = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('[aria-hidden="true"]'));

function cssFor(element: HTMLElement): string {
  const classNames = element.className.split(" ").filter(Boolean);
  const matched: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRule[];
    try {
      rules = Array.from(sheet.cssRules);
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (classNames.some((className) => rule.cssText.includes(`.${className}`))) {
        matched.push(rule.cssText);
      }
    }
  }
  return matched.join("\n");
}

describe("IconGlyph", () => {
  describe("given a mark to render", () => {
    it("hides the decoration from assistive technology", () => {
      const { container } = renderWithDesignSystem(<IconGlyph icon={<OpenAIIcon />} />);
      const [glyph] = glyphsIn(container);

      expect(glyph).toBeDefined();
      expect(glyph?.querySelector("svg")).not.toBeNull();
    });

    it("renders it at the size the caller asked for", () => {
      const { container } = renderWithDesignSystem(
        <IconGlyph icon={<OpenAIIcon />} size="24px" />,
      );
      const [glyph] = glyphsIn(container);

      expect(cssFor(glyph!)).toContain("width: 24px");
      expect(cssFor(glyph!)).toContain("height: 24px");
    });
  });

  describe("given a monochrome mark", () => {
    it("inverts it on the dark surface so a flat black mark stays readable", () => {
      const { container } = renderWithDesignSystem(
        <IconGlyph icon={<AnthropicIcon />} monochrome />,
      );
      const [glyph] = glyphsIn(container);

      expect(cssFor(glyph!)).toContain("invert(1) brightness(0.92)");
    });
  });

  describe("given a brand-coloured mark", () => {
    it("leaves its colours alone", () => {
      const { container } = renderWithDesignSystem(
        <IconGlyph icon={<MicrosoftIcon />} />,
      );
      const [glyph] = glyphsIn(container);
      const css = cssFor(glyph!);

      expect(css).toContain("inline-flex");
      expect(css).not.toContain("invert(1)");
    });
  });
});
