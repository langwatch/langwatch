/**
 * The MCP widget tools' sources list matches the one the platform's REST API publishes, so
 * neither refuses a source the other takes. Spec: dashboards-v2.feature AC200j.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { WIDGET_SOURCES } from "../schemas/widget-sources.js";

const publishedSources = (): string[] => {
  const spec: unknown = JSON.parse(
    readFileSync(
      resolve(__dirname, "../../../../docs/api-reference/openapiLangWatch.json"),
      "utf8",
    ),
  );
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const { enum: values } = node as { enum?: unknown };
    const names = Array.isArray(values) ? values.map(String) : [];
    const isSources = names.includes("langy") && names.includes("other");
    if (isSources) names.forEach((name) => found.add(name));
    Object.values(node).forEach(walk);
  };
  walk(spec);
  return [...found];
};

describe("the MCP sources list", () => {
  it("holds exactly the sources the REST API publishes", () => {
    const published = publishedSources();
    expect(published.length).toBeGreaterThan(0);
    expect(new Set(WIDGET_SOURCES)).toEqual(new Set(published));
  });
});
