import { defaultConfig, mergeConfigs } from "@chakra-ui/react";
import { describe, expect, it } from "vitest";

import { designSystemConfig } from "../src/system/config.ts";
import {
  PRODUCT_COLOURS,
  PRODUCT_NAMES,
  PRODUCT_ROLES,
  type ProductName,
  type ProductRole,
  productColourTokens,
  productRoleTokens,
} from "../src/system/product-colours.ts";

type Mode = "_light" | "_dark";

const theme = mergeConfigs(defaultConfig, designSystemConfig).theme;
const semantic = theme?.semanticTokens?.colors;
const raw = theme?.tokens?.colors;

function entry(tree: unknown, name: string): unknown {
  let value = tree;
  for (const key of name.split(".")) {
    if (!value || typeof value !== "object") return void 0;
    value = Reflect.get(value, key);
  }
  return value;
}

function resolve(name: string, mode: Mode): string {
  const found = entry(semantic, name) ?? entry(raw, name);
  if (!found || typeof found !== "object") throw new Error(`Unknown colour: ${name}`);
  const leaf = "DEFAULT" in found ? found.DEFAULT : found;
  if (!leaf || typeof leaf !== "object" || !("value" in leaf)) {
    throw new Error(`Missing value: ${name}`);
  }
  const value = leaf.value;
  const reference = typeof value === "string" ? value : entry(value, mode);
  if (typeof reference !== "string") throw new Error(`Missing ${mode}: ${name}`);
  return reference.replace(/\{colors\.([^}]+)\}/g, (_match: string, alias: string) =>
    resolve(alias, mode),
  );
}

describe("the product colour map", () => {
  /** @scenario "The map gives Me blue and keeps the current accent for the other products" */
  it("gives Me blue and the other products the current accent", () => {
    expect(PRODUCT_COLOURS).toEqual({
      me: "blue",
      "llm-ops": "accent",
      dashboards: "accent",
      gateway: "accent",
      governance: "accent",
    });
    expect(PRODUCT_NAMES).toEqual(["me", "llm-ops", "dashboards", "gateway", "governance"]);
  });

  /** @scenario "The map gives Me blue and keeps the current accent for the other products" */
  it.each(
    PRODUCT_NAMES.flatMap((name): [ProductName, ProductRole][] =>
      PRODUCT_ROLES.map((role) => [name, role]),
    ),
  )("resolves product.%s.%s to its assigned palette's role in both modes", (name, role) => {
    const palette = PRODUCT_COLOURS[name];
    for (const mode of ["_light", "_dark"] satisfies Mode[]) {
      expect(resolve(`product.${name}.${role}`, mode)).toBe(resolve(`${palette}.${role}`, mode));
    }
  });

  /** @scenario "Changing a product's palette changes every role it generates" */
  it("reaches all ten roles when a fixture map gives a product another palette", () => {
    const tokens = productColourTokens({ colours: { alpha: "green", beta: "accent" } });
    expect(Object.keys(tokens)).toEqual(["alpha", "beta"]);
    expect(PRODUCT_ROLES).toHaveLength(10);
    for (const role of PRODUCT_ROLES) {
      expect(tokens.alpha?.[role]).toEqual({ value: `{colors.green.${role}}` });
      expect(tokens.beta?.[role]).toEqual({ value: `{colors.accent.${role}}` });
    }
  });

  /** @scenario "A product set to null resolves to neutral gray everywhere" */
  it("aliases all ten roles to gray when a product is set to null, keeping its identity", () => {
    const tokens = productColourTokens({ colours: { alpha: null, beta: "blue" } });
    expect(Object.keys(tokens)).toEqual(["alpha", "beta"]);
    for (const role of PRODUCT_ROLES) {
      expect(tokens.alpha?.[role]).toEqual({ value: `{colors.gray.${role}}` });
    }
    expect(productRoleTokens({ colour: null }).solid).toEqual({ value: "{colors.gray.solid}" });
  });
});

describe("the design system theme", () => {
  /** @scenario "The theme registers exactly what the map generates" */
  it("registers the product tokens generated from the map and nothing else", () => {
    expect(entry(semantic, "product")).toEqual(productColourTokens({ colours: PRODUCT_COLOURS }));
  });

  /** @scenario "The theme registers exactly what the map generates" */
  it("leaves the global accent on orange in both modes", () => {
    for (const role of PRODUCT_ROLES) {
      for (const mode of ["_light", "_dark"] satisfies Mode[]) {
        expect(resolve(`accent.${role}`, mode)).toBe(resolve(`orange.${role}`, mode));
      }
    }
    expect(resolve("orange.solid", "_light")).toBe("#ED8926");
  });
});
