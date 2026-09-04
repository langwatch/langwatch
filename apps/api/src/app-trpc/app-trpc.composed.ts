/**
 * The features this process composed BEFORE it had a tRPC mount.
 *
 * Most features compose themselves inside the record's own literal, from the
 * shared infrastructure and the mount, and never appear here. A feature lands
 * in this record when its doors are not only tRPC: the gateway's application is
 * read by `ctx.app` and handed whole to two REST families, so the process must
 * compose it once, early, and hand the router half to the record afterwards.
 *
 * It grows as such features move onto their own compositions, and it is the
 * one place the process names them for the record.
 */
import type { ComposedGatewayFeature } from "../features/gateway/gateway.composition";
import type { ComposedLangyFeature } from "../features/langy/langy.composition";
import type { ComposedOpsFeature } from "../features/ops/ops.composition";
import type { ComposedAnalyticsFeature } from "../features/analytics/analytics.composition";
import type { ComposedDatasetFeature } from "../features/dataset/dataset.composition";
import type { ComposedEvaluatorFeature } from "../features/evaluator/evaluator.composition";
import type { ComposedPromptFeature } from "../features/prompt/prompt.composition";
import type { ComposedFeatureFlagFeature } from "../features/feature-flag/feature-flag.composition";
import type { ComposedDataRetentionFeature } from "../features/data-retention/data-retention.composition";
import type { ComposedMonitorFeature } from "../features/monitor/monitor.composition";
import type { ComposedScenarioFeature } from "../features/scenario/scenario.composition";
import type { ComposedStoredObjectFeature } from "../features/stored-object/stored-object.composition";

export type ComposedApiFeatures = Readonly<{
  /** Six namespaces, one `ctx.app` slice and two REST families over one application. */
  gateway: ComposedGatewayFeature;
  /**
   * Two namespaces and the `ctx.app.langy` slice the packaged Langy REST family
   * reads. Here rather than in the record's literal for that last reason.
   */
  langy: ComposedLangyFeature;
  /**
   * One namespace behind its own operator chain, plus the `ctx.app.ops` slice
   * every other surface's staff check reads. Here rather than in the record's
   * literal because that slice is read by surfaces this feature does not own.
   */
  ops: ComposedOpsFeature;
  /**
   * Three namespaces, the `ctx.app.scenarios` and `ctx.app.suites` slices, and
   * the four services the two packaged scenario REST families take directly.
   */
  scenario: ComposedScenarioFeature;
  /**
   * Two namespaces, the `ctx.app.analytics` and `ctx.app.dashboard` slices, and
   * the governed-SQL runner the public LangWatchQL REST family takes whole.
   */
  analytics: ComposedAnalyticsFeature;
  /**
   * One namespace and the ONE rollout store every other gate on this process
   * reads. Composed before every feature that gates on a flag.
   */
  featureFlag: ComposedFeatureFlagFeature;
  /** Two namespaces and the `ctx.app.dataset` slice the dataset REST family reads. */
  dataset: ComposedDatasetFeature;
  /**
   * One namespace, the `ctx.app.evaluatorApp` slice, and the replication ports
   * the monitor feature takes as its peer.
   */
  evaluator: ComposedEvaluatorFeature;
  /** One namespace and the `ctx.app.prompts` slice two other doors read. */
  prompt: ComposedPromptFeature;
  /** One namespace, over the policy this process supplies the packaged rules. */
  dataRetention: ComposedDataRetentionFeature;
  /** One namespace and the `ctx.app.monitors` slice the monitor REST family reads. */
  monitor: ComposedMonitorFeature;
  /**
   * One namespace, the `ctx.app.storedObjectApp` slice two REST families read,
   * and the content-addressed byte store the scenario-event door writes through.
   */
  storedObject: ComposedStoredObjectFeature;
}>;
