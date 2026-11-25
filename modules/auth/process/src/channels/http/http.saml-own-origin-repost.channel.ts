import { createHash } from "node:crypto";

import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { z } from "zod";

/** The one script the page runs, allowed by its hash and nothing else. */
const SUBMIT_SCRIPT = "document.forms[0].submit();";

const PAGE_POLICY = [
  "default-src 'none'",
  `script-src 'sha256-${createHash("sha256").update(SUBMIT_SCRIPT).digest("base64")}'`,
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

const assertionPostSchema = z.object({
  SAMLResponse: z.string().min(1),
  RelayState: z.string().optional(),
});

// The session cookie is SameSite=Lax, so an IdP's cross-site post arrives without it. An
// unsolicited one gets a page that re-posts it unchanged from our origin (same-origin, so never
// bounced twice). Nothing is read, consumed or set. specs/identity/sso-saml-idp-initiated.feature
export const samlOwnOriginRepost = {
  id: "saml-own-origin-repost",
  hooks: {
    before: [
      {
        matcher: (context) => context.path === "/sso/saml2/sp/acs/:providerId",
        handler: createAuthMiddleware(async (ctx) => {
          if (ctx.headers?.get("sec-fetch-site") !== "cross-site") return;
          const post = assertionPostSchema.safeParse(ctx.body);
          if (!post.success || !answersNoRequest(post.data.SAMLResponse)) return;
          return new Response(repostPage(post.data), {
            status: 200,
            headers: {
              "content-type": "text/html; charset=utf-8",
              "content-security-policy": PAGE_POLICY,
              "cache-control": "no-store",
              "referrer-policy": "no-referrer",
            },
          });
        }),
      },
    ],
  },
} satisfies BetterAuthPlugin;

/** Whether a posted response answers no request: its root element carries no InResponseTo. */
function answersNoRequest(samlResponse: string): boolean {
  const xml = Buffer.from(samlResponse, "base64").toString("utf8");
  const root = /<(?:[\w.-]+:)?Response\b[^>]*>/.exec(xml)?.[0];
  return root !== undefined && !/\sInResponseTo\s*=/.test(root);
}

function repostPage(post: z.infer<typeof assertionPostSchema>): string {
  const field = ({ name, value }: { name: string; value: string | undefined }) =>
    value === undefined ? "" : `<input type="hidden" name="${name}" value="${escaped(value)}">`;
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Signing you in</title></head>',
    '<body><form method="post">',
    field({ name: "SAMLResponse", value: post.SAMLResponse }),
    field({ name: "RelayState", value: post.RelayState }),
    '<noscript><button type="submit">Continue signing in</button></noscript></form>',
    `<script>${SUBMIT_SCRIPT}</script></body></html>`,
  ].join("");
}

function escaped(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
