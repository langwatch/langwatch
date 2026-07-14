import { describe, expect, it } from "vitest";
import {
  buildResourceHref,
  buildSurfaceHref,
  resolveCapability,
  SURFACE_BY_FEATURE,
} from "../components/capabilities/capabilityRegistry";
import { CAPABILITY_CATALOG } from "../components/capabilities/capabilityCatalog";
import { FEATURES } from "~/shared/langy/featureMap";

describe("resolveCapability, given a LangWatch CLI tool call", () => {
  describe("when the CLI searched traces", () => {
    it("renders the trace-sample card, which shows the matched traces themselves", () => {
      expect(resolveCapability("langwatch.trace.search")).toMatchObject({
        render: "traces",
        tone: "read",
        surface: "traces",
        overline: "Traces",
        body: "rows",
      });
    });
  });

  describe("when the CLI read one trace", () => {
    it("renders the single-trace card", () => {
      expect(resolveCapability("langwatch.trace.get")).toMatchObject({
        render: "trace",
        tone: "read",
        surface: "traces",
        overline: "trace",
      });
    });
  });

  describe("when the CLI queried analytics", () => {
    it("renders the metrics card", () => {
      expect(resolveCapability("langwatch.analytics.query")).toMatchObject({
        render: "metrics",
        tone: "read",
        surface: "analytics",
        overline: "Analytics",
      });
    });
  });

  describe("when the CLI ran an experiment", () => {
    it("renders the evaluation-run card", () => {
      expect(resolveCapability("langwatch.experiment.run")).toMatchObject({
        render: "evalRun",
        tone: "read",
        surface: "experiments",
        overline: "Run experiment",
        body: "stats",
      });
    });
  });

  describe("when the CLI wrote a resource", () => {
    it("renders a created card for a create", () => {
      expect(resolveCapability("langwatch.dataset.create")).toMatchObject({
        render: "resourceCreated",
        tone: "created",
        surface: "datasets",
        overline: "New dataset",
        body: "text",
      });
    });

    it("renders an updated card for an update", () => {
      expect(resolveCapability("langwatch.monitor.update")).toMatchObject({
        render: "resourceUpdated",
        tone: "updated",
        surface: "evaluations",
        overline: "Update monitor",
      });
    });

    it("renders a removed card for a delete", () => {
      expect(resolveCapability("langwatch.trigger.delete")).toMatchObject({
        render: "resourceRemoved",
        tone: "removed",
        surface: "automations",
        overline: "Delete trigger",
      });
    });
  });

  describe("when the CLI pushed a prompt", () => {
    it("renders the diff card", () => {
      expect(resolveCapability("langwatch.prompt.push")).toMatchObject({
        render: "promptDiff",
        tone: "updated",
        surface: "prompts",
        overline: "Push prompt",
        body: "diff",
      });
    });
  });

  describe("when the CLI command is a sub-command group", () => {
    it("resolves dataset records to the dataset card", () => {
      expect(resolveCapability("langwatch.dataset.records")).toMatchObject({
        render: "dataset",
        tone: "read",
        surface: "datasets",
        overline: "Datasets",
        body: "rows",
      });
    });
  });

  describe("when the resource name is kebab-case", () => {
    it("words it as a phrase from the catalog", () => {
      expect(resolveCapability("langwatch.simulation-run.get")).toMatchObject({
        render: "evalRun",
        tone: "read",
        surface: "simulations",
        overline: "simulation run",
      });
    });
  });

  describe("when the CLI touched a gateway resource", () => {
    it("renders a card on the gateway surface with its catalog wording", () => {
      expect(resolveCapability("langwatch.virtual-keys.list")).toMatchObject({
        render: "resourceRead",
        tone: "read",
        surface: "gateway",
        overline: "Virtual keys",
        body: "rows",
        icon: "key",
      });
    });

    it("reads a key rotation as an update", () => {
      expect(resolveCapability("langwatch.virtual-keys.rotate")).toMatchObject({
        render: "resourceUpdated",
        tone: "updated",
        overline: "Rotate virtual key",
      });
    });
  });

  describe("when the catalog names a widget for a specific verb", () => {
    it("uses the verb's widget over the derived default", () => {
      expect(resolveCapability("langwatch.ingest.health")).toMatchObject({
        body: "stats",
        surface: "gateway",
      });
    });
  });

  describe("when the CLI command names a resource the catalog has never heard of", () => {
    const capability = resolveCapability("langwatch.flux-capacitor.list");

    it("still resolves a card, worded from the command itself", () => {
      expect(capability).toMatchObject({
        render: "resourceRead",
        tone: "read",
        surface: "platform",
        overline: "Flux capacitors",
        body: "rows",
        noun: { singular: "flux capacitor", plural: "flux capacitors" },
      });
    });

    it("offers no deep link rather than a broken one", () => {
      expect(
        buildSurfaceHref({ surface: "platform", projectSlug: "acme" }),
      ).toBeNull();
    });
  });

  describe("when the tool name is not a LangWatch CLI call at all", () => {
    it("falls through for a shell call that was never re-typed", () => {
      expect(resolveCapability("bash")).toBeNull();
    });

    it("falls through for a malformed name with extra segments", () => {
      expect(resolveCapability("langwatch.trace.search.extra")).toBeNull();
    });
  });
});

describe("buildResourceHref, given a row-level deep link", () => {
  describe("when the surface has per-resource pages", () => {
    it("links straight to the resource", () => {
      expect(
        buildResourceHref({
          surface: "traces",
          projectSlug: "acme",
          resourceId: "trace_1",
        }),
      ).toBe("/acme/messages/trace_1");
    });
  });

  describe("when the surface only has an index page", () => {
    it("returns null instead of five rows all linking to the same index", () => {
      expect(
        buildResourceHref({
          surface: "prompts",
          projectSlug: "acme",
          resourceId: "prompt_1",
        }),
      ).toBeNull();
    });
  });
});

describe("the card binding, given the catalog and feature map are the sources of structure", () => {
  describe("when a fallback surface is bound to a feature", () => {
    it("binds only to features the map actually declares", () => {
      const featureIds = new Set(FEATURES.map((feature) => feature.id));
      const unknown = Object.keys(SURFACE_BY_FEATURE).filter(
        (id) => !featureIds.has(id),
      );

      expect(unknown).toEqual([]);
    });
  });

  describe("when any feature-mapped CLI command resolves", () => {
    it("resolves a card for every CLI command of every feature", () => {
      const unresolved: string[] = [];

      for (const feature of FEATURES) {
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

  describe("when a feature-mapped resource is also cataloged", () => {
    it("agrees with the feature map about the surface, where both bind one", () => {
      // The catalog is the primary binding; the feature map only enriches the
      // fallback. Where both know a resource they must not point different ways.
      const disagreements: string[] = [];

      for (const feature of FEATURES) {
        const featureSurface = SURFACE_BY_FEATURE[feature.id];
        if (!featureSurface) continue;
        for (const command of feature.cli) {
          const resource = command.split(/\s+/)[0]!;
          const entry =
            CAPABILITY_CATALOG[resource as keyof typeof CAPABILITY_CATALOG];
          if (entry && entry.surface !== featureSurface) {
            disagreements.push(
              `${resource}: catalog says ${entry.surface}, feature ${feature.id} says ${featureSurface}`,
            );
          }
        }
      }

      expect(disagreements).toEqual([]);
    });
  });
});
