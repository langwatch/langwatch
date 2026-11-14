import { moduleApi, type Named } from "@langwatch/module";
import { RUM_SESSION_HEADER } from "@langwatch/react-rum/constants";
import { z } from "zod";

/** The header the door names a caller by, self-asserted. */
const rumReportHeadersSchemaDefinition = z.object({
  [RUM_SESSION_HEADER]: z.string().optional(),
});
export interface RumReportHeadersSchema extends Named<typeof rumReportHeadersSchemaDefinition> {}
export const rumReportHeadersSchema: RumReportHeadersSchema = rumReportHeadersSchemaDefinition;

/** One browser trace export as the ingest door received it; every field is untrusted. */
export type BrowserTraceReport = Readonly<{
  /** The OTLP/JSON body, already capped in bytes by the door. */
  body: string;
  /** The visit the browser says it belongs to, self-asserted. */
  session: string | undefined;
  /** The caller's address as the door resolved it, or null where none was. */
  callerAddress: string | null;
}>;

/** The platform's own browser telemetry, proxied to its collector (ADR-058). */
export interface RumApi {
  /** Validates and forwards one export; a refusal is a `rum_*` handled error. */
  ingestBrowserTraces(report: BrowserTraceReport): Promise<void>;
}

export const RumApi = moduleApi<RumApi>()("rum");
