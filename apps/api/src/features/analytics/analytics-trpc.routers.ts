/**
 * The two analytics namespaces, and the port groups they are assembled from.
 *
 * Apart from the composition because `ComposedAnalyticsFeature` names this
 * function's return type, and that record is reached by every program naming
 * `AppRouter`. Through the composition it would drag the composition's
 * adapters, its Prisma resolution and its ClickHouse client along with it.
 */
import type { filterFieldsEnum } from "@langwatch/analytics-contract";
import type { sharedFiltersInputSchema, timeseriesInputSchema } from "@langwatch/analytics-server";
import type { AnalyticsTrpcPorts, LangWatchQLTrpcPorts } from "@langwatch/analytics-server";
import type { z } from "zod";
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import { createAnalyticsTrpcRouter, createLangWatchQLTrpcRouter } from "./analytics-trpc.mount.ts";

/** The filter fields this deployment offers, as the enum publishes them. */
export type ApiFilterField = (typeof filterFieldsEnum)["options"][number];

/** The charted reads' ports, with this deployment's two shared input schemas. */
export type ApiAnalyticsReadPorts = AnalyticsTrpcPorts<
  ApiTimeseriesInput,
  ApiReadInput,
  ApiFilterField,
  ApiTimeseriesInputWire,
  ApiReadInputWire
>;

/**
 * What each shared schema publishes to a CLIENT and hands to a HANDLER, named
 * apart because for these two they differ: `filters` carries a default, so the
 * wire may omit it while the parsed value always has it.
 */
type ApiReadInput = z.output<typeof sharedFiltersInputSchema>;
type ApiReadInputWire = z.input<typeof sharedFiltersInputSchema>;
type ApiTimeseriesInput = z.output<typeof timeseriesInputSchema>;
type ApiTimeseriesInputWire = z.input<typeof timeseriesInputSchema>;

/** The two port groups the `analytics.*` namespace is assembled from. */
export type AnalyticsFeaturePorts = Readonly<{
  reads: ApiAnalyticsReadPorts;
  workbench: LangWatchQLTrpcPorts;
}>;

/**
 * The charted reads and the workbench, built the one way whether the feature
 * composed or not. `analytics.savedWorkbenchCharts` is the dashboard feature's
 * and is merged onto this namespace by the process's tRPC record.
 */
export function analyticsRouters(mount: ApiTrpcFeatureMount, ports: AnalyticsFeaturePorts) {
  return {
    analytics: mount.root.mergeRouters(
      createAnalyticsTrpcRouter({ ...mount, ports: ports.reads }),
      mount.root.router({
        lwql: createLangWatchQLTrpcRouter({ ...mount, ports: ports.workbench }),
      }),
    ),
  };
}
