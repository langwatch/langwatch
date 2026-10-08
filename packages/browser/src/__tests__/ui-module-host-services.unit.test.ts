import { hostService } from "@langwatch/browser-host/declarations";
import { describe, expect, it } from "vitest";

import {
  BrowserHostServiceRefusedError,
  resolveHostServices,
} from "../module/ui-module-host-services.ts";
import { createUi } from "../ui-supply.ts";
import { defineBrowserModule } from "../web-module.ts";

type Clock = { now: () => number };
const ClockService = hostService<Clock>("clock");
const PulseService = hostService<Clock>("pulse");
const clock = { load: () => Promise.resolve({ default: { now: () => 1 } }) };

describe("resolveHostServices", () => {
  describe("given each service provided by one installed module", () => {
    /** @scenario Each host service resolves to its one installed provider */
    it("returns each provider in the runtime's order, not install order", () => {
      const resolved = resolveHostServices({
        modules: [
          defineBrowserModule("trace").provides(PulseService, clock),
          defineBrowserModule("evaluator").provides(ClockService, clock),
        ],
        services: [ClockService, PulseService],
      });

      expect(resolved.map(({ service, module }) => [service, module])).toEqual([
        ["clock", "evaluator"],
        ["pulse", "trace"],
      ]);
    });
  });

  describe("given a service no installed module provides", () => {
    /** @scenario A host service with no provider is refused at install */
    it("refuses, naming the service", () => {
      expect(() =>
        resolveHostServices({ modules: [defineBrowserModule("trace")], services: [ClockService] }),
      ).toThrow(/"clock" has no installed provider/);
    });
  });

  describe("given a service two installed modules provide", () => {
    /** @scenario A host service with two providers is refused at install */
    it("refuses, naming the service and both providers", () => {
      expect(() =>
        resolveHostServices({
          modules: [
            defineBrowserModule("trace").provides(ClockService, clock),
            defineBrowserModule("evaluator").provides(ClockService, clock),
          ],
          services: [],
        }),
      ).toThrow(/"clock" is provided by both "trace" and "evaluator"/);
    });
  });
});

describe("createUi", () => {
  describe("given a composition installing two providers of one host service", () => {
    /** @scenario The composition refuses two providers before it renders */
    it("refuses the render before anything mounts", async () => {
      const ui = createUi({
        document: { getElementById: () => null, querySelector: () => null },
        mount: "root",
      }).withModules([
        defineBrowserModule("trace").provides(ClockService, clock),
        defineBrowserModule("evaluator").provides(ClockService, clock),
      ]);

      await expect(ui.render()).rejects.toBeInstanceOf(BrowserHostServiceRefusedError);
    });
  });
});
