import { describe, expect, it } from "vitest";

import { isGovernedLayer, layerCrossing } from "../../grammar/module-layers.mjs";

// ADR-181: the layer tables an opted-in framework package reads. Vocabulary and
// telemetry are leaves; app/ composes the tiers and is not a governed layer.

function crossing({ layer, sourcePath, specifier, typeOnly = false }) {
  return layerCrossing({ layer, sourcePath, specifier, typeOnly });
}

describe("given the framework layer rows", () => {
  describe("when vocabulary imports", () => {
    const sourcePath = "vocabulary/eventing.ts";

    it("takes vocabulary, rules and telemetry", () => {
      for (const specifier of [
        "./event.ts",
        "../rules/compare-ordinal.rules.ts",
        "../telemetry/eventing.metrics.ts",
      ]) {
        expect(crossing({ layer: "vocabulary", sourcePath, specifier })).toBeUndefined();
      }
    });

    it("reports a repository, a channel or a service it names as a value", () => {
      expect(
        crossing({
          layer: "vocabulary",
          sourcePath,
          specifier: "../features/replay/repositories/replay-marker.repository.ts",
        }),
      ).toBe("a repository");
      expect(
        crossing({ layer: "vocabulary", sourcePath, specifier: "../channels/lane.channel.ts" }),
      ).toBe("a channel");
      expect(
        crossing({ layer: "vocabulary", sourcePath, specifier: "../services/fold.service.ts" }),
      ).toBe("a service");
    });

    it("lets a type cross", () => {
      expect(
        crossing({
          layer: "vocabulary",
          sourcePath,
          specifier: "../services/fold.service.ts",
          typeOnly: true,
        }),
      ).toBeUndefined();
    });
  });

  describe("when telemetry imports", () => {
    it("takes only telemetry as a value", () => {
      const sourcePath = "telemetry/eventing.metrics.ts";
      expect(
        crossing({ layer: "telemetry", sourcePath, specifier: "./process-manager.metrics.ts" }),
      ).toBeUndefined();
      expect(
        crossing({ layer: "telemetry", sourcePath, specifier: "../rules/lanes.rules.ts" }),
      ).toBe("a rules module");
    });
  });

  describe("when a nested repository or channel imports", () => {
    it("takes telemetry and its concern's vocabulary, and still refuses a service", () => {
      const sourcePath = "features/replay/repositories/redis/redis.replay-marker.repository.ts";
      expect(
        crossing({
          layer: "repositories",
          sourcePath,
          specifier: "../../../../telemetry/eventing.metrics.ts",
        }),
      ).toBeUndefined();
      expect(
        crossing({ layer: "repositories", sourcePath, specifier: "../../vocabulary/replay.ts" }),
      ).toBeUndefined();
      expect(
        crossing({
          layer: "channels",
          sourcePath: "features/replay/channels/redis/redis.queue-activity.channel.ts",
          specifier: "../../../../telemetry/eventing.metrics.ts",
        }),
      ).toBeUndefined();
      expect(
        crossing({
          layer: "repositories",
          sourcePath,
          specifier: "../../services/replay.service.ts",
        }),
      ).toBe("a service");
    });
  });

  describe("when a nested service names a tier", () => {
    it("reports the backend below the interface", () => {
      const sourcePath = "features/replay/services/replay.service.ts";
      expect(
        crossing({
          layer: "services",
          sourcePath,
          specifier: "../repositories/redis/redis.replay-marker.repository.ts",
        }),
      ).toBe("a repository backend");
      expect(
        crossing({
          layer: "services",
          sourcePath,
          specifier: "../channels/redis/redis.queue-activity.channel.ts",
        }),
      ).toBe("a channel implementation");
      expect(
        crossing({
          layer: "services",
          sourcePath,
          specifier: "../repositories/replay-marker.repository.ts",
        }),
      ).toBeUndefined();
    });
  });

  describe("when the layer is app", () => {
    it("is not governed, so the composition root may build every tier", () => {
      expect(isGovernedLayer("app")).toBe(false);
      expect(isGovernedLayer("vocabulary")).toBe(true);
      expect(isGovernedLayer("telemetry")).toBe(true);
    });
  });
});
