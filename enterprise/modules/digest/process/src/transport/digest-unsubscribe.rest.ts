// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * `/api/digest/unsubscribe`: GET only shows a page, so a link scanner's prefetch unsubscribes no
 * one; RFC 8058 and the page's button POST. The token is the whole authorization; pages refuse
 * framing and caching since the address holds it. Spec: digest.feature.
 */
import { publicRoute } from "@langwatch/api/access";
import {
  callerAddressContext,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestBytesProducer,
} from "@langwatch/api/rest";
import { DigestApi, digestTokenQuerySchema } from "@langwatch/enterprise-digest-contract";

import { DIGEST_UNSUBSCRIBE_PATH } from "../rules/digest-mail.rules.ts";
import {
  askPage,
  RESUBSCRIBE_PATH,
  resubscribedPage,
  unsubscribedPage,
} from "../rules/digest-unsubscribe-pages.rules.ts";

const HTML = "text/html; charset=UTF-8";

/** Never framed: `frame-ancestors` says so to current browsers, `X-Frame-Options` to older ones. */
const UNFRAMEABLE = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  // The token rides in the URL and the form action: nothing may keep the page or pass it on.
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
} as const;

const TOKEN_IS_THE_AUTHORIZATION =
  "RFC 8058 one-click unsubscribe from the weekly digest: the email arrives where no session " +
  "exists, and the HMAC token naming one person is the whole authorization";

const TOKEN_ERRORS = [
  { status: 400, description: "The token is missing, invalid, expired or tampered with" },
  { status: 429, description: "Too many attempts from this caller; wait a minute" },
  { status: 503, description: "No signing secret is configured, so no link can be checked" },
];

export const digestUnsubscribeRest = defineRestRouter(DigestApi)
  .withNamespace("digest")
  .withVersion(MANAGEMENT_API_VERSION)
  // The address is printed in emails already sent: it never moves, and has no /api/v1 twin.
  .withAddressing("literal", { v1Twin: false })

  .get(DIGEST_UNSUBSCRIBE_PATH, "readDigestSubscription")
  .withQuery(digestTokenQuerySchema)
  .withAccess(publicRoute({ reason: TOKEN_IS_THE_AUTHORIZATION }))
  .withResponse("bytes", { produces: HTML })
  .withDocs({
    hide: true,
    summary: "The weekly digest's unsubscribe page",
    errors: TOKEN_ERRORS,
  })
  .withMiddlewareContext(callerAddressContext)
  .handle(async ({ app, input, response }, callerAddress) =>
    htmlPage(
      response,
      (await app.isSubscribed({ ...input, callerAddress }))
        ? askPage(input.token)
        : unsubscribedPage(input.token),
    ),
  )

  .post(DIGEST_UNSUBSCRIBE_PATH, "unsubscribeFromDigest")
  // An opt-out is a recorded preference, as automation's one-click unsubscribe keeps records.
  .keepsRecords()
  .withAudit("digest.unsubscribe")
  .withQuery(digestTokenQuerySchema)
  .withAccess(publicRoute({ reason: TOKEN_IS_THE_AUTHORIZATION }))
  .withResponse("bytes", { produces: HTML })
  .withDocs({
    hide: true,
    summary: "RFC 8058 one-click unsubscribe from the weekly digest",
    errors: TOKEN_ERRORS,
  })
  .withMiddlewareContext(callerAddressContext)
  .handle(async ({ app, input, response }, callerAddress) => {
    await app.unsubscribe({ ...input, callerAddress });
    return htmlPage(response, unsubscribedPage(input.token));
  })

  .post(RESUBSCRIBE_PATH, "resubscribeToDigest")
  // Resubscribing clears the opt-out on the person's row; it removes nothing.
  .keepsRecords()
  .withAudit("digest.resubscribe")
  .withQuery(digestTokenQuerySchema)
  .withAccess(publicRoute({ reason: TOKEN_IS_THE_AUTHORIZATION }))
  .withResponse("bytes", { produces: HTML })
  .withDocs({
    hide: true,
    summary: "Resubscribe to the weekly digest from its unsubscribe page",
    errors: TOKEN_ERRORS,
  })
  .withMiddlewareContext(callerAddressContext)
  .handle(async ({ app, input, response }, callerAddress) => {
    await app.resubscribe({ ...input, callerAddress });
    return htmlPage(response, resubscribedPage(input.token));
  })

  .build();

/**
 * A page as one chunk: only the stream producer takes headers, and the anti-framing, no-store and
 * no-referrer headers must ride every page whatever the surface's own floor holds.
 */
function htmlPage(response: RestBytesProducer<typeof HTML>, html: string) {
  const bytes = new TextEncoder().encode(html);
  return response.stream(
    (async function* () {
      yield bytes;
    })(),
    { mediaType: HTML, byteLength: bytes.byteLength, headers: UNFRAMEABLE },
  );
}
