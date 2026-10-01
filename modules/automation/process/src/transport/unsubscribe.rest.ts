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
import { AutomationApi, unsubscribeRestAcknowledgedSchema } from "@langwatch/automation-contract";
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
  .withOutput(unsubscribeRestAcknowledgedSchema)
  .withDocs({
    tags: ["Triggers"],
    summary: "RFC 8058 one-click unsubscribe",
    description:
      "Stop the automation named by the signed token in `token` from mailing this recipient.",
    errors: [
      { status: 400, description: "The token is missing, invalid or tampered with" },
      { status: 429, description: "Too many unsubscribe attempts from this caller" },
    ],
  })
  .withMiddleware(unsubscribeCallerAddress)
  .handle(async ({ app, input }, callerAddress) => {
    await app.acceptUnsubscribe({
      token: input.token ?? "",
      scope: "trigger",
      callerAddress,
      via: "one-click",
    });

    logger.info("One-click unsubscribe processed");

    return { ok: true };
  })

  .build();
