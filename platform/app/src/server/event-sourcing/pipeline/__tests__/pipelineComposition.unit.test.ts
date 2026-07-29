/**
 * ADR-082 Rule 1 as a build failure, plus the layer-6 membership check the
 * ADR's Consequences section asks for.
 *
 * Binds `specs/event-sourcing/pipeline-model.feature`. The analysis itself
 * lives in `pipelineCompositionRule.ts` next door, which documents why the
 * mechanism is a source read rather than a lint rule or a runtime assertion on
 * the built definition.
 */

import { describe, expect, it } from "vitest";
import { definePipeline } from "../staticBuilder";
import {
  analyzeAllPipelines,
  analyzePipelineSource,
  builderWithMethodNames,
  NON_REGISTERING_BUILDER_METHODS,
  REGISTERING_BUILDER_METHODS,
} from "./pipelineCompositionRule";
import {
  createMockFoldProjection,
  createMockMapProjection,
  createTestCommandHandlerClass,
  type TestEvent,
} from "./testHelpers";

interface KnownViolation {
  /** Directory under `pipelines/`. */
  pipeline: string;
  /** Dotted path from the deps root, exactly as the analyzer reports it. */
  dep: string;
  /** Why it is still here, and what closing it would take. */
  reason: string;
}

/**
 * The ADR-082 Rule 1 violations that exist today. A SHRINK-ONLY ratchet, in the
 * spirit of `scripts/check-feature-parity.ts`'s `LEGACY_INERT`:
 *
 *   - An entry may be REMOVED. Adding one is how the rule dies, so a new
 *     violation fails the first test below instead.
 *   - An entry that no longer describes a violation ALSO fails, in the second
 *     test. A list that tolerates dead entries stops describing the code and
 *     starts hiding it.
 *
 * Both directions are checked because only both together make the list a
 * measurement. Entries are keyed by (pipeline, dep) and cover that dep's
 * `deps-type` and `call-site` violations together — a dep that is a registered
 * definition AND is handed straight to the builder is one problem, not two.
 */
const KNOWN_RULE1_VIOLATIONS: readonly KnownViolation[] = [
  {
    pipeline: "trace-processing",
    dep: "automations.triggerMatchSubscriber",
    reason:
      "`createTraceAlertTriggerMatchSubscriber` is `@ee/governance/subscribers/" +
      "traceAlertTriggerMatch.subscriber.ts`. ADR-082 'What does not move': an " +
      "OSS pipeline file cannot import `ee/` unconditionally without breaking " +
      "an OSS build, so the definition crosses the boundary whole. Needs an " +
      "enterprise composition seam, which is its own decision.",
  },
  {
    pipeline: "trace-processing",
    dep: "gatewayBudgetDebitsProjection",
    reason:
      "`createGatewayBudgetDebitsProjection` is `@ee/governance/*` (ADR-075 " +
      "Class C — gateway spend is derived state, so it is a projection). Same " +
      "enterprise composition seam as the other four.",
  },
  {
    pipeline: "trace-processing",
    dep: "governanceKpisProjection",
    reason:
      "`createGovernanceKpisProjection` is `@ee/governance/*`. Same enterprise " +
      "composition seam.",
  },
  {
    pipeline: "trace-processing",
    dep: "governanceOcsfEventsProjection",
    reason:
      "`createGovernanceOcsfEventsProjection` is `@ee/governance/*` — the OCSF " +
      "audit stream. Same enterprise composition seam.",
  },
  {
    pipeline: "trace-processing",
    dep: "virtualKeyLastUsedSubscriber",
    reason:
      "`createVirtualKeyLastUsedSubscriber` is " +
      "`@ee/governance/subscribers/virtualKeyLastUsed.subscriber.ts` — the " +
      "best-effort `VirtualKey.lastUsedAt` touch the debit write split from. " +
      "Same enterprise composition seam.",
  },
];

function keyOf({ pipeline, dep }: { pipeline: string; dep: string }): string {
  return `${pipeline} / ${dep}`;
}

describe("ADR-082 Rule 1 — nothing in a pipeline's Deps is a value the builder registers", () => {
  describe("when every pipelines/*/pipeline.ts is read", () => {
    /** @scenario "A pipeline dependency is never a value the builder registers" */
    it("reports every violation that is not on the known-violations list", () => {
      const known = new Set(KNOWN_RULE1_VIOLATIONS.map(keyOf));

      const unexpected = analyzeAllPipelines()
        .filter((violation) => !known.has(keyOf(violation)))
        .map((violation) => violation.message);

      expect(unexpected).toEqual([]);
    });

    /** @scenario "The known-violations list only ever shrinks" */
    it("rejects a known-violations entry that no longer describes a violation", () => {
      const violating = new Set(analyzeAllPipelines().map(keyOf));

      const stale = KNOWN_RULE1_VIOLATIONS.filter(
        (entry) => !violating.has(keyOf(entry)),
      ).map(
        (entry) =>
          `${keyOf(entry)} no longer violates ADR-082 Rule 1 — delete its KNOWN_RULE1_VIOLATIONS entry.`,
      );

      expect(stale).toEqual([]);
    });
  });

  describe("when a pipeline declares a dep typed as a value the builder registers", () => {
    /** @scenario "A dependency typed as a registered definition is named with its type" */
    it("names the pipeline, the dep, the forbidden type and the registering method", () => {
      const violations = analyzePipelineSource({
        pipeline: "example-processing",
        source: `
          export interface ExamplePipelineDeps {
            governanceKpisProjection: MapProjectionDefinition<unknown, E>;
          }
          export function createExamplePipeline(deps: ExamplePipelineDeps) {
            return definePipeline<E>()
              .withName("example")
              .withMapProjection("governanceKpis", deps.governanceKpisProjection)
              .build();
          }
        `,
      });

      expect(violations.map((violation) => violation.message)).toContain(
        "example-processing: dep `governanceKpisProjection` is a MapProjectionDefinition, " +
          "which ADR-082 Rule 1 forbids — it is the value `.withMapProjection()` registers " +
          "(pipeline.ts:3). Construct it in pipeline.ts and let the dep be an argument to it.",
      );
    });

    /** @scenario "A registered value hidden inside a dependency bundle is still a violation" */
    it("follows a locally declared bundle and names the nested dep by its path", () => {
      const violations = analyzePipelineSource({
        pipeline: "example-processing",
        source: `
          interface EnterpriseBundle {
            triggerMatchSubscriber: EventSubscriberDefinition<E>;
          }
          export interface ExamplePipelineDeps {
            automations: EnterpriseBundle;
          }
          export function createExamplePipeline(deps: ExamplePipelineDeps) {
            return definePipeline<E>()
              .withName("example")
              .withEventSubscriber("triggerMatch", buildIt(deps.automations))
              .build();
          }
        `,
      });

      expect(
        violations.map(({ dep, kind, typeName }) => ({ dep, kind, typeName })),
      ).toEqual([
        {
          dep: "automations.triggerMatchSubscriber",
          kind: "deps-type",
          typeName: "EventSubscriberDefinition",
        },
      ]);
    });
  });

  describe("when a pipeline hands a dep whose type reveals nothing to a registering call", () => {
    /** @scenario "A dependency handed straight to a registering call is named with that call" */
    it("names the registering call a dep was handed to directly", () => {
      const violations = analyzePipelineSource({
        pipeline: "example-processing",
        source: `
          export interface ExamplePipelineDeps {
            alertSubscriber: SomeOpaqueType;
          }
          export function createExamplePipeline(deps: ExamplePipelineDeps) {
            return definePipeline<E>()
              .withName("example")
              .withEventSubscriber("alert", deps.alertSubscriber)
              .build();
          }
        `,
      });

      expect(violations.map((violation) => violation.message)).toContain(
        "example-processing: `.withEventSubscriber()` is handed `deps.alertSubscriber` " +
          "directly (pipeline.ts:8), which ADR-082 Rule 1 forbids — the argument must be " +
          "constructed in pipeline.ts; `deps.x` may appear inside it, never be it.",
      );
    });
  });

  describe("when a dep is only an argument to a value the pipeline constructs", () => {
    /** @scenario "A dependency used as an argument to a constructed value is legal" */
    it("reports no violation", () => {
      const violations = analyzePipelineSource({
        pipeline: "example-processing",
        source: `
          export interface ExamplePipelineDeps {
            governanceKpisRepository: GovernanceKpisRepository;
            dispatch: ExampleDispatchDeps;
          }
          export function createExamplePipeline(deps: ExamplePipelineDeps) {
            return definePipeline<E>()
              .withName("example")
              .withMapProjection(
                "governanceKpis",
                new GovernanceKpisMapProjection({ store: deps.governanceKpisRepository }),
              )
              .withProcessManager("example", examplePM(deps.dispatch))
              .build();
          }
        `,
      });

      expect(violations).toEqual([]);
    });
  });

  describe("when the builder's with* surface is compared with the rule's method lists", () => {
    /** @scenario "Every builder method is classified as registering or not" */
    it("classifies every with* method StaticPipelineBuilder exposes", () => {
      const classified = new Set<string>([
        ...REGISTERING_BUILDER_METHODS,
        ...NON_REGISTERING_BUILDER_METHODS,
      ]);

      const unclassified = builderWithMethodNames()
        .filter((method) => !classified.has(method))
        .map(
          (method) =>
            `StaticPipelineBuilder.${method}() is not classified by ADR-082 Rule 1 — ` +
            "add it to REGISTERING_BUILDER_METHODS or NON_REGISTERING_BUILDER_METHODS " +
            "in pipelineCompositionRule.ts (and, if it registers a value, list the type " +
            "it accepts in REGISTERED_VALUE_TYPES).",
        );

      expect(unclassified).toEqual([]);
    });

    it("keeps every classified method present on the builder", () => {
      const onBuilder = new Set(builderWithMethodNames());

      const missing = [
        ...REGISTERING_BUILDER_METHODS,
        ...NON_REGISTERING_BUILDER_METHODS,
      ].filter((method) => !onBuilder.has(method));

      expect(missing).toEqual([]);
    });
  });
});

describe("StaticPipelineBuilder", () => {
  describe("when a pipeline is defined with a command, a fold projection and a map projection", () => {
    /** @scenario "Defining a pipeline" */
    it("carries all three into the definition and into its introspection metadata", () => {
      const definition = definePipeline<TestEvent>()
        .withName("trace_processing")
        .withAggregateType("trace")
        .withCommand("recordSpan", createTestCommandHandlerClass())
        .withFoldProjection(
          "traceSummary",
          createMockFoldProjection<Record<string, never>, TestEvent>({
            name: "traceSummary",
          }),
        )
        .withMapProjection(
          "spanStorage",
          createMockMapProjection<Record<string, never>, TestEvent>({
            name: "spanStorage",
          }),
        )
        .build();

      expect(definition.commands.map((command) => command.name)).toEqual([
        "recordSpan",
      ]);
      expect([...definition.foldProjections.keys()]).toEqual(["traceSummary"]);
      expect([...definition.mapProjections.keys()]).toEqual(["spanStorage"]);

      expect(definition.metadata.name).toBe("trace_processing");
      expect(definition.metadata.aggregateType).toBe("trace");
      expect(definition.metadata.projections.map(({ name }) => name)).toEqual([
        "traceSummary",
      ]);
      expect(
        definition.metadata.mapProjections.map(({ name }) => name),
      ).toEqual(["spanStorage"]);
      expect(definition.metadata.commands.map(({ name }) => name)).toEqual([
        "recordSpan",
      ]);
    });
  });
});
