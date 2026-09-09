// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "@langwatch/api/rest";
import type { ScimService } from "@langwatch/enterprise-scim-contract";
import { nowInstant, type Instant } from "@langwatch/time";
import type { MiddlewareHandler } from "hono";

import {
  SCIM_WEBHOOK_SIGNATURE_HEADER,
  SCIM_WEBHOOK_TOLERANCE_SECONDS,
  verifyScimWebhookSignature,
} from "../../rules/scim-webhook-signature.rules.ts";

type ScimWebhookVariables = {
  scimWebhookEvents: unknown[];
  scimWebhookOrganizationId: string;
};

class ScimWebhookReplayWindow {
  private readonly seen = new Map<string, number>();

  claim(nonce: string, nowSeconds: number): boolean {
    for (const [key, at] of this.seen) {
      if (nowSeconds - at > SCIM_WEBHOOK_TOLERANCE_SECONDS) this.seen.delete(key);
    }
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, nowSeconds);
    return true;
  }
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ").trim();
  return token.length > 0 ? token : null;
}

/**
 * Validates an Auth0 directory delivery before an endpoint sees its events.
 * The request clone preserves the raw-body route input for later framework
 * validation while verification retains the exact bytes Auth0 signed.
 */
export function scimWebhookAuth(options: {
  scim: () => ScimService;
  webhookSecret: () => string | undefined;
  now?: () => Instant;
}): MiddlewareHandler<{ Variables: ScimWebhookVariables }> {
  const replays = new ScimWebhookReplayWindow();
  const clock = options.now ?? nowInstant;

  return async (context, next) => {
    const secret = options.webhookSecret();
    if (!secret) throw new NotFoundError("Webhook not configured");

    const raw = await context.req.raw.clone().text();
    const nowSeconds = Math.floor(clock().epochMilliseconds / 1000);
    const signature = verifyScimWebhookSignature({
      secret,
      body: raw,
      header: context.req.header(SCIM_WEBHOOK_SIGNATURE_HEADER),
      nowSeconds,
    });
    if (!signature.verified || !replays.claim(signature.nonce, nowSeconds)) {
      throw new UnauthorizedError();
    }

    const token = bearerToken(context.req.header("authorization"));
    if (!token) throw new UnauthorizedError();
    const entitlement = await options.scim().verifyToken({ token });
    if (entitlement.status === "invalid_token") throw new UnauthorizedError();
    if (entitlement.status !== "ok") throw new ForbiddenError();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestError("Invalid JSON");
    }

    context.set("scimWebhookOrganizationId", entitlement.organizationId);
    context.set("scimWebhookEvents", Array.isArray(parsed) ? parsed : [parsed]);
    await next();
  };
}
