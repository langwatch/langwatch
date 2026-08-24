import { describe, expect, it } from "vitest";
import { EnterpriseCatalogue } from "../src";

describe("EnterpriseCatalogue", () => {
  it("discovers licensing through portable package names", () => {
    expect(EnterpriseCatalogue.create().get("licensing")).toEqual({
      id: "licensing",
      contractPackage: "@langwatch/enterprise-licensing-contract",
      serverPackage: "@langwatch/enterprise-licensing-server",
    });
  });
});
