import { AlertType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { EXAMPLE_MATCHES, TEMPLATE_VARIABLES } from "../exampleContext";

const TEMPLATE_VARIABLE_PATHS = TEMPLATE_VARIABLES.map((v) => v.path);

import { buildTemplateContext } from "../templateContext";

function resolve(path: string, context: unknown): unknown {
  const segments = path.split(".");
  const root = segments[0];
  let current: unknown = (context as Record<string, unknown>)[root!];
  for (const segment of segments.slice(1)) {
    if (current == null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

describe("template variable contract", () => {
  const context = buildTemplateContext({
    trigger: {
      id: "tr_1",
      name: "High latency",
      alertType: AlertType.WARNING,
    },
    project: { name: "Acme", slug: "acme" },
    baseHost: "https://app.langwatch.ai",
    matches: EXAMPLE_MATCHES,
  });

  describe("when resolving every advertised variable path against the example context", () => {
    it.each(
      TEMPLATE_VARIABLE_PATHS,
    )("%s resolves to a provided value", (path) => {
      expect(resolve(path, context)).not.toBeUndefined();
    });
  });
});
