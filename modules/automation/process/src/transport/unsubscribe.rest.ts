/**
 * The RFC 8058 one-click unsubscribe endpoint (ADR-031). The `?token=` is
 * the authorization, so no session is resolved. A valid token answers 200,
 * a bad one 400, a throttled caller 429, and any other method 405.
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import {
  AutomationApi,
  unsubscribeRestAcknowledgedSchema,
  unsubscribeRestRefusalSchema,
  UnsubscribeLinkInvalidError,
  UnsubscribeRateLimitedError,
} from "@langwatch/automation-contract";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

const logger = createLogger("langwatch:unsubscribe:one-click");

/**
 * Which caller a request is counted as: header priority, falling back to
 * the raw socket address from the Node server's connection info. Headers
 * alone would drop every caller that sends none into a single bucket.
 */
export const unsubscribeCallerAddress = defineRestMiddleware(
  "unsubscribeCallerAddress",
  z.string().nullable(),
);

/** The token the mail client appends to the link it was sent. */
const unsubscribeQuery = z.object({ token: z.string().optional() });

const ONE_CLICK_IS_TOKEN_AUTHORIZED =
  "RFC 8058 one-click unsubscribe; the HMAC token in ?token= is the authorization, no session";

/**
 * `/api/unsubscribe`, at exactly the address every already-sent message points
 * at. Literal because the mail client's link is the contract, not a dated
 * namespace.
 */
export const unsubscribeRest = defineRestRouter(AutomationApi)
  .withNamespace("unsubscribe")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })

  .post("/api/unsubscribe", "confirmOneClickUnsubscribe")
  .withQuery(unsubscribeQuery)
  .withAccess(publicRoute({ reason: ONE_CLICK_IS_TOKEN_AUTHORIZED }))
  .responds({
    200: unsubscribeRestAcknowledgedSchema,
    400: unsubscribeRestRefusalSchema,
    429: unsubscribeRestRefusalSchema,
  })
  .withDocs({
    tags: ["Triggers"],
    summary: "RFC 8058 one-click unsubscribe",
    description:
      "Stop the automation named by the signed token in `token` from mailing this recipient.",
  })
  .withMiddleware(unsubscribeCallerAddress)
  .handle(async ({ app, input }, callerAddress) => {
    const token = input.token ?? null;

    if (!token) return { status: 400, body: { error: "Missing token" } } as const;

    try {
      await app.acceptUnsubscribe({
        token,
        scope: "trigger",
        callerAddress,
        via: "one-click",
      });
    } catch (err) {
      // A bad or tampered token (4xx) is not a downstream persistence failure
      // (5xx): a database blip must never be reported to the mail client as an
      // invalid link, so anything else is re-raised for the family's boundary.
      if (err instanceof UnsubscribeRateLimitedError) {
        return { status: 429, body: { error: "Too many requests" } } as const;
      }

      if (err instanceof UnsubscribeLinkInvalidError) {
        return { status: 400, body: { error: "Invalid token" } } as const;
      }

      throw err;
    }

    logger.info("One-click unsubscribe processed");

    return { status: 200, body: { ok: true } } as const;
  })

  /**
   * RFC 8058 one-click is POST-only. Declared AFTER the POST route so a
   * POST resolves there; every other method falls through here for a 405
   * with `Allow`, not a bare 404.
   */
  .get("/api/unsubscribe", "unsubscribeMethodGuard")
  .withAccess(publicRoute({ reason: ONE_CLICK_IS_TOKEN_AUTHORIZED }))
  .withRawResponse({ produces: "application/json" })
  .anyMethod()
  .handle(() => ({
    status: 405,
    headers: { Allow: "POST", "Content-Type": "application/json" },
    body: JSON.stringify({ error: "Method not allowed" }),
  }))
  .build();
