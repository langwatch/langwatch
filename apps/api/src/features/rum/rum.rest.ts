/**
 * `POST /api/rum/v1/traces` — browser telemetry intake, proxied through the
 * app's own origin so production keeps OTLP off the internet. The route stays
 * thin; `rum-ingest.service.ts` decides cost and claims. See ADR-058.
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import { RUM_TRACES_PATH } from "@langwatch/react-rum/constants";
import { featureApi } from "@langwatch/runtime-composition";
import { z } from "zod";

/** What the door hands the ingest path, once per export. */
export interface RumIngestApi {
  /**
   * Reads one export under the body cap and forwards it, or refuses by name.
   * The whole request is passed because the cap has to be enforced while the
   * bytes stream: a declared `content-length` is a hint a caller can lie about.
   */
  acceptExport(input: { request: Request; callerKey: string }): Promise<void>;
}

export const RumIngestApi = featureApi<RumIngestApi>("trace");

/** The session the browser asserts for itself, as the process read it. */
export const rumSession = defineRestMiddleware("rumSession", z.string().nullable());

/** The forwarding chain, for a browser that asserted no session. */
export const rumForwardedFor = defineRestMiddleware("rumForwardedFor", z.string().nullable());

/**
 * Names the caller for the per-caller rate-limit bucket. Both inputs are
 * self-asserted, so `x-forwarded-for` reads only the LAST hop (nearest us);
 * neither is reliable enough alone, hence the service's global cap too.
 */
export function rumCallerKey({
  session,
  forwardedFor,
}: {
  session: string | null;
  forwardedFor: string | null;
}): string {
  if (session) return `session:${session.slice(0, 64)}`;

  const hops = forwardedFor?.split(",") ?? [];
  const nearest = hops[hops.length - 1]?.trim();

  return `ip:${nearest ?? "unknown"}`;
}

/**
 * Literal because the family's own path already names its generation, so there
 * is no `/api/v1` twin, and `/api/rum` is not a prefix anyone else shares.
 */
export const rumRest = defineRestRouter(RumIngestApi)
  .withNamespace("rum")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post(RUM_TRACES_PATH, "ingestBrowserTraces")
  .withAccess(
    publicRoute({
      reason:
        "Browser telemetry ingest; the browser has no credential to present and the payload is treated as untrusted",
    }),
  )
  .withMiddleware(rumSession, rumForwardedFor)
  // The route reads its own body under a cap and answers no body at all; the
  // media type it names is the one its refusals carry.
  .withRawResponse({ produces: "application/json" })
  .handle(async ({ app, request }, session, forwardedFor) => {
    await app.acceptExport({ request, callerKey: rumCallerKey({ session, forwardedFor }) });

    return { status: 202, body: null };
  })
  .build();
