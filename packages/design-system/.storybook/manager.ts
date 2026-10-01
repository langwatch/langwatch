import { tokens, type ThemeName } from "@langwatch/design-system-internal/tokens";
import { addons } from "storybook/manager-api";
import { create } from "storybook/theming";

/**
 * The manager wears the internal consoles' paper look (ADR-160); stories keep
 * the product system. The manager's scheme follows the OS; the toolbar still
 * sets each story's colour mode.
 */
const pickScheme = (): ThemeName =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const pixels = ({ value }: { value: string }): number => Number.parseInt(value, 10);

const paperTheme = ({ scheme }: { scheme: ThemeName }) => {
  const colour = tokens[scheme];
  return create({
    base: scheme,
    brandTitle: "LangWatch design system",
    colorPrimary: colour.brand,
    colorSecondary: colour.brand,
    appBg: colour["paper-soft"],
    appContentBg: colour.paper,
    appHoverBg: colour["paper-deep"],
    appPreviewBg: colour.paper,
    appBorderColor: colour.line,
    appBorderRadius: pixels({ value: tokens.radius.md }),
    fontBase: tokens.font.sans,
    fontCode: tokens.font.mono,
    textColor: colour["ink-900"],
    textInverseColor: colour.paper,
    textMutedColor: colour["ink-500"],
    barTextColor: colour["ink-600"],
    barHoverColor: colour.brand,
    barSelectedColor: colour.brand,
    barBg: colour.paper,
    buttonBg: colour.paper,
    buttonBorder: colour["line-strong"],
    booleanBg: colour["paper-deep"],
    booleanSelectedBg: colour.paper,
    inputBg: colour.paper,
    inputBorder: colour["line-strong"],
    inputTextColor: colour["ink-900"],
    inputBorderRadius: pixels({ value: tokens.radius.sm }),
  });
};

addons.setConfig({ theme: paperTheme({ scheme: pickScheme() }) });
