import { describe, expect, it } from "vitest";
import { prismaTables } from "./ownership.ts";
import { prismaTableCatalogue } from "./table-catalogue.ts";
import { parsePrismaDatamodel } from "./datamodel.ts";

describe("Prisma table claims", () => {
  it("keeps the generated model catalogue in sync with the schema", () => {
    expect(Object.keys(prismaTableCatalogue).sort()).toEqual(
      parsePrismaDatamodel()
        .map((model) => model.name)
        .sort(),
    );
  });
  it("declares the endpoint and delivery tables without constructing a client", () => {
    const claim = prismaTables("WebhookEndpoint", "WebhookEndpointDelivery");
    expect(claim).toEqual({
      store: "prisma",
      tables: ["WebhookEndpoint", "WebhookEndpointDelivery"],
    });
    expect(Object.isFrozen(claim.tables)).toBe(true);
  });
  it.each([[], ["MissingModel"], ["__proto__"], ["constructor"]])(
    "rejects invalid untyped input %j",
    (models) => {
      expect(() => Reflect.apply(prismaTables, null, models)).toThrow();
    },
  );
});
