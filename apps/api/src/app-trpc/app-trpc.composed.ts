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
}>;
