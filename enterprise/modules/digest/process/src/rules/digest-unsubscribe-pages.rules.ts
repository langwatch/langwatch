// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The unsubscribe address's HTML pages: markup and copy, so the transport only routes. */
import { DIGEST_UNSUBSCRIBE_PATH } from "./digest-mail.rules.ts";

/** Where the unsubscribed page's button POSTs to clear the opt-out. */
export const RESUBSCRIBE_PATH = "/api/digest/resubscribe";

// The token was verified before any page is written, so it is our own base64url and hex;
// it is still URL-encoded, which leaves nothing an attribute could be broken out of.
const withToken = (path: string, token: string) => `${path}?token=${encodeURIComponent(token)}`;

/** Asks before unsubscribing: GET only shows this, so a link scanner unsubscribes no one. */
export const askPage = (token: string): string =>
  page({
    heading: "Unsubscribe from the weekly summary?",
    body: "You will stop receiving LangWatch's weekly email about your usage.",
    action: { path: withToken(DIGEST_UNSUBSCRIBE_PATH, token), label: "Unsubscribe" },
  });

/** Confirms the opt-out and offers to undo it. */
export const unsubscribedPage = (token: string): string =>
  page({
    heading: "You are unsubscribed",
    body: "LangWatch will not send you the weekly summary again. Changed your mind?",
    action: { path: withToken(RESUBSCRIBE_PATH, token), label: "Resubscribe" },
  });

/** Confirms the opt-out was cleared and offers it again. */
export const resubscribedPage = (token: string): string =>
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
