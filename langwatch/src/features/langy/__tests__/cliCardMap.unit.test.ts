import { describe, expect, it } from "vitest";
import { resolveCapability } from "../components/capabilities/capabilityRegistry";
import { CARD_BY_FEATURE } from "../components/capabilities/cliCardMap";
import { FEATURES } from "~/shared/langy/featureMap";

describe("resolveCapability, given a LangWatch CLI tool call", () => {
  describe("when the CLI searched traces", () => {
    it("renders the trace-sample card, which shows the matched traces themselves", () => {
      expect(resolveCapability("langwatch.trace.search")).toEqual({
        render: "traceSample",
        tone: "read",
        surface: "traces",
        overline: "Traces",
      });
    });
  });

  describe("when the CLI read one trace", () => {
    it("renders the single-trace card", () => {
      expect(resolveCapability("langwatch.trace.get")).toEqual({
        render: "trace",
        tone: "read",
        surface: "traces",
        overline: "trace",
      });
    });
  });

  describe("when the CLI queried analytics", () => {
    it("renders the metrics card", () => {
      expect(resolveCapability("langwatch.analytics.query")).toEqual({
        render: "metrics",
        tone: "read",
        surface: "analytics",
        overline: "Analytics",
      });
    });
  });

  describe("when the CLI ran an experiment", () => {
    it("renders the evaluation-run card", () => {
      expect(resolveCapability("langwatch.experiment.run")).toEqual({
        render: "evalRun",
        tone: "read",
        surface: "experiments",
        overline: "Run experiment",
      });
    });
  });

  describe("when the CLI wrote a resource", () => {
    it("renders a created card for a create", () => {
      expect(resolveCapability("langwatch.dataset.create")).toEqual({
        render: "resourceCreated",
        tone: "created",
        surface: "datasets",
        overline: "New dataset",
      });
    });

    it("renders an updated card for an update", () => {
      expect(resolveCapability("langwatch.monitor.update")).toEqual({
        render: "resourceUpdated",
        tone: "updated",
        surface: "evaluations",
        overline: "Update monitor",
      });
    });

    it("renders a removed card for a delete", () => {
      expect(resolveCapability("langwatch.trigger.delete")).toEqual({
        render: "resourceRemoved",
        tone: "removed",
        surface: "automations",
        overline: "Delete trigger",
      });
    });
  });

  describe("when the CLI command is a sub-command group", () => {
    it("resolves dataset records to the dataset card", () => {
      expect(resolveCapability("langwatch.dataset.records")).toEqual({
        render: "dataset",
        tone: "read",
        surface: "datasets",
        overline: "Datasets",
      });
    });
  });

  describe("when the resource name is kebab-case", () => {
    it("words it as a phrase", () => {
      expect(resolveCapability("langwatch.simulation-run.get")).toEqual({
        render: "evalRun",
        tone: "read",
        surface: "simulations",
        overline: "simulation run",
      });
    });
  });

  describe("when the CLI command has no card", () => {
    it("falls through for a command the feature map does not list", () => {
      expect(resolveCapability("langwatch.gateway-budgets.list")).toBeNull();
    });

    it("falls through for a shell call that was never re-typed", () => {
      expect(resolveCapability("bash")).toBeNull();
    });
  });
});

describe("the card binding, given feature-map.json is the source of structure", () => {
  describe("when a card is bound to a feature", () => {
    it("binds only to features the map actually declares", () => {
      const featureIds = new Set(FEATURES.map((feature) => feature.id));
      const unknown = Object.keys(CARD_BY_FEATURE).filter(
        (id) => !featureIds.has(id),
      );

      expect(unknown).toEqual([]);
    });

    it("resolves a card for every CLI command of every bound feature", () => {
      const unresolved: string[] = [];

      for (const feature of FEATURES) {
        if (!CARD_BY_FEATURE[feature.id]) continue;
        for (const command of feature.cli) {
          const [resource, verb] = command.split(/\s+/);
          if (!resolveCapability(`langwatch.${resource}.${verb}`)) {
            unresolved.push(command);
          }
        }
      }

      expect(unresolved).toEqual([]);
    });
  });
});
