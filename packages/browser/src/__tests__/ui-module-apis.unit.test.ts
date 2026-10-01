/**
 * Spec: specs/ui/module-api-mounting.feature
 */
import { describe, expect, it } from "vitest";

import { installedModuleApis } from "../ui-module-apis.ts";
import { defineBrowserModule } from "../web-module.ts";

const Provider = () => null;

describe("installedModuleApis", () => {
  describe("given installed modules that declare an api", () => {
    /** @scenario Every module that declares an api has its provider mounted */
    it("returns both providers, each named by its module", () => {
      const mounted = installedModuleApis([
        defineBrowserModule("navigation").withApi({ Provider }),
        defineBrowserModule("trace").withApi({ Provider }),
      ]);

      expect(mounted.map((binding) => binding.name)).toEqual(["navigation", "trace"]);
      expect(mounted.every((binding) => binding.Provider === Provider)).toBe(true);
    });
  });

  describe("given a module whose declared api carries no Provider", () => {
    /** @scenario A module whose declared api has nothing to mount is refused by name */
    it("refuses, naming the module", () => {
      expect(() => installedModuleApis([defineBrowserModule("prompt").withApi({})])).toThrow(
        /"prompt"/,
      );
    });
  });

  describe("given a module that declares no api", () => {
    /** @scenario A module that declares no api is passed over */
    it("returns nothing for it and raises no refusal", () => {
      expect(installedModuleApis([defineBrowserModule("styles-only")])).toEqual([]);
    });
  });
});
