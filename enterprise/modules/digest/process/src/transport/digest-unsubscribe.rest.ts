// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The weekly digest's unsubscribe address, `/api/digest/unsubscribe?token=`. The email's footer
 * link opens it (GET, a page that changes nothing, so a link scanner's prefetch unsubscribes
 * no one); the RFC 8058 header and the page's button POST to it. The signed token is the whole
 * authorization, so no session is resolved. A bad or expired token answers 400; with no signing
 * secret configured, 503. Each call counts one attempt per caller before anything is read, and a
 * caller past the limit answers 429. Every page refuses to be framed, since its button changes a
 * subscription in one click, and is neither stored nor passed on by Referer, since its address
 * holds the token.
 * Spec: enterprise/modules/digest/specs/digest.feature
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineMiddlewareContext,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestBytesProducer,
} from "@langwatch/api/rest";
import { DigestApi, digestTokenQuerySchema } from "@langwatch/enterprise-digest-contract";
import { z } from "zod";

import { DIGEST_UNSUBSCRIBE_PATH } from "../rules/digest-mail.rules.ts";

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
  { status: 429, description: "Too many attempts from this caller; wait a few minutes" },
  { status: 503, description: "No signing secret is configured, so no link can be checked" },
];

/**
 * Which caller a request is counted as: the client address resolved from the request, or null
 * when none can be, which the throttle counts in one shared bucket rather than skipping.
 */
export const digestCallerAddress = defineMiddlewareContext(
  "digestCallerAddress",
  z.string().nullable(),
);

const RESUBSCRIBE_PATH = "/api/digest/resubscribe";

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
  .withMiddlewareContext(digestCallerAddress)
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
  .withMiddlewareContext(digestCallerAddress)
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
  .withMiddlewareContext(digestCallerAddress)
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

// The token was verified before any page is written, so it is our own base64url and hex;
// it is still URL-encoded, which leaves nothing an attribute could be broken out of.
const withToken = (path: string, token: string) => `${path}?token=${encodeURIComponent(token)}`;

const askPage = (token: string) =>
  page({
    heading: "Unsubscribe from the weekly summary?",
    body: "You will stop receiving LangWatch's weekly email about your usage.",
    action: { path: withToken(DIGEST_UNSUBSCRIBE_PATH, token), label: "Unsubscribe" },
  });

const unsubscribedPage = (token: string) =>
  page({
    heading: "You are unsubscribed",
    body: "LangWatch will not send you the weekly summary again. Changed your mind?",
    action: { path: withToken(RESUBSCRIBE_PATH, token), label: "Resubscribe" },
  });

const resubscribedPage = (token: string) =>
  page({
    heading: "You are subscribed again",
    body: "You will receive next week's summary.",
    action: { path: withToken(DIGEST_UNSUBSCRIBE_PATH, token), label: "Unsubscribe" },
  });

function page({
  heading,
  body,
  action,
}: {
  heading: string;
  body: string;
  action: { path: string; label: string };
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${heading} | LangWatch</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f7f7f8;color:#1a1a1a}
main{max-width:28rem;margin:15vh auto;padding:2rem;background:#fff;border-radius:12px}
h1{font-size:1.25rem;margin:0 0 .75rem}p{line-height:1.5;margin:0 0 1.5rem}
button{font:inherit;padding:.6rem 1.2rem;border:0;border-radius:8px;background:#1a1a1a;color:#fff;cursor:pointer}
</style>
</head>
<body>
<main>
<h1>${heading}</h1>
<p>${body}</p>
<form method="post" action="${action.path}"><button type="submit">${action.label}</button></form>
</main>
</body>
</html>
`;
}
