import type { Named } from "@langwatch/module";
import { z } from "zod";

/**
 * Where the span widgets' history starts: `span_analytics` holds every span from `from` on, the
 * instant its replay step recorded (analytics ADR-006); null when it is whole. `rebuilding` while
 * no replay has recorded a start, when older span history may still be missing.
 */
const spanAnalyticsFloorSchemaDefinition = z.object({
  from: z.string().nullable(),
  rebuilding: z.boolean(),
});
export interface SpanAnalyticsFloorSchema extends Named<
  typeof spanAnalyticsFloorSchemaDefinition
> {}
export const spanAnalyticsFloorSchema: SpanAnalyticsFloorSchema =
  spanAnalyticsFloorSchemaDefinition;
export type SpanAnalyticsFloor = z.infer<typeof spanAnalyticsFloorSchema>;
