import { moduleApi } from "@langwatch/kernel/module-api";
import { RUM_SESSION_HEADER } from "@langwatch/react-rum/constants";
import { z } from "zod";

/** The two headers the door names a caller by, both self-asserted. */
export const rumReportHeadersSchema = z.object({
  [RUM_SESSION_HEADER]: z.string().optional(),
  "x-forwarded-for": z.string().optional(),
});

/** One browser trace export as the ingest door received it; every field is untrusted. */
export type BrowserTraceReport = Readonly<{
  /** The OTLP/JSON body, already capped in bytes by the door. */
  body: string;
  /** The visit the browser says it belongs to, self-asserted. */
  session: string | undefined;
  /** `x-forwarded-for` as the proxies in front of this process wrote it. */
  forwardedFor: string | undefined;
}>;

/** The platform's own browser telemetry, proxied to its collector (ADR-058). */
export interface RumApi {
  /** Validates and forwards one export; a refusal is a `rum_*` handled error. */
  ingestBrowserTraces(report: BrowserTraceReport): Promise<void>;
}

export const RumApi = moduleApi<RumApi>()("rum");
