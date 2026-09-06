import { describe, expect, it } from "vitest";

// Regression for the boot crash: protectedProcedure is a custom builder
// that only exposes .mutation/.query after a permission .use(). A procedure
// declared without one throws at module load ("X.mutation is not a
// function"), which crashes the API process — unit tests that only import
// services miss it. Importing the router module here reproduces the boot.
describe("modelProviders router module", () => {
  it("loads without throwing and exposes update", async () => {
    const mod = await import("../modelProviders");
    expect(mod.modelProviderRouter).toBeDefined();
    expect(
      (mod.modelProviderRouter as any)._def.procedures.update,
    ).toBeDefined();
  });
});
