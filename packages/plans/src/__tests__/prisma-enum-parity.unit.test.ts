import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { planCatalogue } from "../catalogue.ts";
import { PRICING_MODELS } from "../plan-type.ts";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const schema = readFileSync(
  join(workspaceRoot, "packages/prisma-client/prisma/schema.prisma"),
  "utf8",
);

/** The values of one `enum` block in schema.prisma, read rather than generated. */
function prismaEnum(name: string): string[] {
  const block = new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`).exec(schema);
  if (!block?.[1]) throw new Error(`enum ${name} not found in schema.prisma`);

  return block[1]
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((line) => line.length > 0)
    .sort();
}

describe("given schema.prisma and the catalogue", () => {
  describe("when the stored plan types are compared", () => {
    /** @scenario "Every stored plan type is a Postgres plan type" */
    it("names the same plans on both sides", () => {
      const stored = planCatalogue
        .all()
        .filter((plan) => plan.storedAsPlanType)
        .map((plan) => plan.type)
        .sort();

      expect(stored).toEqual(prismaEnum("PlanTypes"));
    });
  });

  describe("when the pricing models are compared", () => {
    /** @scenario "Every pricing model is a Postgres pricing model" */
    it("names the same models on both sides", () => {
      expect([...PRICING_MODELS].sort()).toEqual(prismaEnum("PricingModel"));
    });
  });
});
