/**
 * The one assignment of an accent to each product. Change a value to retune a product, set it
 * to null to take its accent away; nothing else spells this mapping. See adrs/003.
 */

/** An existing semantic palette a product may take as its accent. */
export type ProductAccentPalette =
  | "accent"
  | "orange"
  | "blue"
  | "green"
  | "cyan"
  | "teal"
  | "purple"
  | "pink"
  | "red"
  | "yellow";

export type ProductColourMap = Readonly<Record<string, ProductAccentPalette | null>>;

export const PRODUCT_COLOURS = {
  me: "blue",
  "llm-ops": "accent",
  dashboards: "accent",
  gateway: "accent",
  governance: "accent",
} satisfies ProductColourMap;

/** A product as the design system knows it; navigation proves its registry has the same keys. */
export type ProductName = keyof typeof PRODUCT_COLOURS;

export function isProductName(name: string): name is ProductName {
  return Object.hasOwn(PRODUCT_COLOURS, name);
}

export const PRODUCT_NAMES: readonly ProductName[] =
  Object.keys(PRODUCT_COLOURS).filter(isProductName);

export type ProductRole =
  | "solid"
  | "contrast"
  | "fg"
  | "muted"
  | "subtle"
  | "emphasized"
  | "hover"
  | "focusRing"
  | "indicator"
  | "onSolid";

export const PRODUCT_ROLES: readonly ProductRole[] = [
  "solid",
  "contrast",
  "fg",
  "muted",
  "subtle",
  "emphasized",
  "hover",
  "focusRing",
  "indicator",
  "onSolid",
];

/** The palette a product's roles alias: its assigned one, or neutral gray when removed. */
export function resolveProductPalette({
  colour,
}: {
  colour: ProductAccentPalette | null;
}): ProductAccentPalette | "gray" {
  return colour ?? "gray";
}

export type ProductRoleTokens = Record<ProductRole, { value: string }>;

function alias({ palette, role }: { palette: string; role: ProductRole }) {
  return { value: `{colors.${palette}.${role}}` };
}

/** The ten roles of one product, each aliasing the same role of its resolved palette. */
export function productRoleTokens({
  colour,
}: {
  colour: ProductAccentPalette | null;
}): ProductRoleTokens {
  const palette = resolveProductPalette({ colour });
  return {
    solid: alias({ palette, role: "solid" }),
    contrast: alias({ palette, role: "contrast" }),
    fg: alias({ palette, role: "fg" }),
    muted: alias({ palette, role: "muted" }),
    subtle: alias({ palette, role: "subtle" }),
    emphasized: alias({ palette, role: "emphasized" }),
    hover: alias({ palette, role: "hover" }),
    focusRing: alias({ palette, role: "focusRing" }),
    indicator: alias({ palette, role: "indicator" }),
    onSolid: alias({ palette, role: "onSolid" }),
  };
}

/** The `product.<id>.*` semantic tokens config.ts registers, generated from one map. */
export function productColourTokens({
  colours,
}: {
  colours: ProductColourMap;
}): Record<string, ProductRoleTokens> {
  return Object.fromEntries(
    Object.entries(colours).map(([name, colour]) => [name, productRoleTokens({ colour })]),
  );
}
