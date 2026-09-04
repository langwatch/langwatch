// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The Auth0 SCIM webhook's HTTP intake: `POST /api/webhooks/auth0-scim`.
 *
 * Thin on purpose — parsing and provisioning live in {@link ScimWebhookApi}.
 * The answers this door owns are the ones the mount cannot delegate. An install
 * that configured no shared secret answers 404 rather than 401, so a deployment
 * that never enabled directory sync looks like one that never served the path.
 * Everything else is one question asked three ways: is this delivery from the
 * provider (a signature over the raw bytes, keyed with the deployment secret),
 * is it fresh (a timestamp inside the tolerance, and a nonce not seen before),
 * and WHOSE directory does it provision? The tenant comes from the SCIM token
 * the caller presents — the same per-connection credential the SCIM protocol
 * routes authenticate with — and never from the payload, because a body that
 * can name its own organization makes one global secret authority over every
 * organization with a matching SSO domain.
 */
import { internalSecret } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";

import { ScimWebhookApi } from "../../api/scim-webhook/scim-webhook.api";
import {
  SCIM_WEBHOOK_SIGNATURE_HEADER,
  SCIM_WEBHOOK_TOLERANCE_SECONDS,
  verifyScimWebhookSignature,
} from "../../rules/scim-webhook-signature.rules";
import type { ScimService } from "@langwatch/enterprise-scim-contract";

/** Everything the intake reaches that the SCIM boundary does not own. */
export type ScimWebhookRestPorts = Readonly<{
  /** The SAME application the protocol family provisions through. */
  scim: () => ScimService;
  /**
   * The shared secret the delivery is signed with, or none.
   *
   * A function rather than a value, and its absence is a 404: an install that
   * configured no secret has no webhook, and answering 401 would confirm the
   * path exists to anyone who probed it.
   */
  webhookSecret: () => string | undefined;
  /** Wall clock, injectable so the freshness window is testable. */
  now?: () => Date;
}>;

/**
 * The nonces already spent inside the tolerance window.
 *
 * Per process, which is what an in-memory window can promise: it blunts the
 * replay a captured delivery makes cheap, while the timestamp tolerance is the
 * bound that holds across every replica.
 */
class ScimWebhookReplayWindow {
  private readonly seen = new Map<string, number>();

  /** True when this nonce is new, and remembers it; false when it repeats. */
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

/** Builds the `/api/webhooks/auth0-scim` family over one process's ports. */
export function createScimWebhookRestApp(options: {
  security: AppRestSecurity;
  ports: ScimWebhookRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api/webhooks" });
  const scimWebhookApi = ScimWebhookApi.create();
  const replays = new ScimWebhookReplayWindow();
  const clock = ports.now ?? (() => new Date());

  secured
    .access(
      internalSecret(
        "auth0 SCIM webhook: signed with the deployment secret, tenanted by the presented SCIM token",
      ),
    )
    .post("/auth0-scim", async (c) => {
      const secret = ports.webhookSecret();
      if (!secret) return c.json({ error: "Webhook not configured" }, { status: 404 });

      const raw = await c.req.text();
      const nowSeconds = Math.floor(clock().getTime() / 1000);
      const signature = verifyScimWebhookSignature({
        secret,
        body: raw,
        header: c.req.header(SCIM_WEBHOOK_SIGNATURE_HEADER),
        nowSeconds,
      });
      if (!signature.verified) return c.json({ error: "Unauthorized" }, { status: 401 });
      if (!replays.claim(signature.nonce, nowSeconds))
        return c.json({ error: "Unauthorized" }, { status: 401 });

      const token = bearerToken(c.req.header("authorization"));
      if (!token) return c.json({ error: "Unauthorized" }, { status: 401 });
      const entitlement = await ports.scim().verifyToken({ token });
      if (entitlement.status === "invalid_token")
        return c.json({ error: "Unauthorized" }, { status: 401 });
      if (entitlement.status !== "ok") return c.json({ error: "Forbidden" }, { status: 403 });

      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return c.json({ error: "Invalid JSON" }, { status: 400 });
      }
      await scimWebhookApi.handle({
        service: ports.scim(),
        organizationId: entitlement.organizationId,
        events: Array.isArray(body) ? body : [body],
      });
      return c.json({ received: true });
    });

  return secured.hono;
}
