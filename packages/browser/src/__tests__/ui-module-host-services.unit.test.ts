import {
  UNAVAILABLE_UI_FEEDBACK,
  UNAVAILABLE_UI_SCOPE,
  UNAVAILABLE_UI_SESSION,
  type UiHostServiceInput,
  type UiHostServiceSource,
} from "@langwatch/browser-host/capabilities";
import { hostService } from "@langwatch/browser-host/declarations";
import { describe, expect, it } from "vitest";

import {
  BrowserHostServiceRefusedError,
  loadHostServices,
  resolveHostServices,
  runHostServices,
} from "../module/ui-module-host-services.ts";
import { createUi } from "../ui-supply.ts";
import { defineBrowserModule } from "../web-module.ts";
import { createUiFeatureApiClient } from "../wire/transport.ts";

type Clock = { now: () => number };
const ClockService = hostService<UiHostServiceSource<Clock>>("clock");
const PulseService = hostService<UiHostServiceSource<Clock>>("pulse");
const clock = { load: () => Promise.resolve({ default: (): Clock => ({ now: () => 1 }) }) };

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

describe("runHostServices", () => {
  describe("given two host services whose sources are loaded", () => {
    /** @scenario Each provided source runs with the shared input, in the runtime's order */
    it("calls each source with the one input, in order, and keeps each value under its service", async () => {
      const calls: { name: string; input: UiHostServiceInput }[] = [];
      const sourceOf = (name: string) => ({
        load: () =>
          Promise.resolve({
            default: (input: UiHostServiceInput): Clock => {
              calls.push({ name, input });
              return { now: () => name.length };
            },
          }),
      });
      const sources = await loadHostServices({
        modules: [
          defineBrowserModule("trace").provides(PulseService, sourceOf("pulse")),
          defineBrowserModule("time").provides(ClockService, sourceOf("clock")),
        ],
        services: [ClockService, PulseService],
      });
      const input: UiHostServiceInput = {
        transport: createUiFeatureApiClient({ fetch: () => Promise.reject(new Error("offline")) }),
        feedback: UNAVAILABLE_UI_FEEDBACK,
        session: UNAVAILABLE_UI_SESSION,
        scope: UNAVAILABLE_UI_SCOPE,
      };

      const values = runHostServices({ sources, input });

      expect(calls.map(({ name }) => name)).toEqual(["clock", "pulse"]);
      expect(calls.every((call) => call.input === input)).toBe(true);
      expect([...values.keys()]).toEqual(["clock", "pulse"]);
    });
  });
});
