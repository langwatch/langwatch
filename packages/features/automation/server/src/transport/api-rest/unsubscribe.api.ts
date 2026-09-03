/**
 * The RFC 8058 one-click unsubscribe endpoint.
 *
 * ADR-031: mail clients POST here (body `List-Unsubscribe=One-Click`) when the
 * recipient hits the native "unsubscribe" affordance. The token in `?token=`
 * is the authorization — its HMAC binds it to one recipient — so this route
 * needs no session. One-click is trigger-scoped (the link the
 * `List-Unsubscribe` header carries). Always returns 200 to a valid token so
 * the mail client shows success; a malformed/missing token is a 400, non-POST
 * methods get 405, and rate-limited callers get 429.
 */

import { publicEndpoint } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import { InvalidUnsubscribeTokenError } from "@langwatch/automation-contract";
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";

import type { AutomationApp } from "#app/automation.app";

const logger = createLogger("langwatch:unsubscribe:one-click");

/** Everything the one-click door reaches that automation does not own. */
export type UnsubscribeRestPorts = Readonly<{
  /** The application the confirmed token is spent against. */
  automation: () => AutomationApp;
  /** The process's fixed-window counter. */
  rateLimit: (input: {
    key: string;
    windowSeconds: number;
    max: number;
  }) => Promise<{ allowed: boolean }>;
  /**
   * Which caller a request is counted as.
   *
   * A port because the answer depends on the process's HTTP adapter: header
   * priority is one half, and the raw socket address — reachable only through
   * the Node server's own connection info — is the other. A family that read
   * headers alone would drop every caller that sends none into a single
   * bucket.
   */
  clientAddress: (c: Context) => string | undefined;
}>;

/** Builds the public one-click unsubscribe family over one process's ports. */
export function createUnsubscribeRestApp(options: {
  security: AppRestSecurity;
  ports: UnsubscribeRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api" });

  secured
    .access(
      publicEndpoint(
        "RFC 8058 one-click unsubscribe; HMAC token in ?token= is the authorization, no session",
      ),
    )
    .post("/unsubscribe", async (c) => {
      const ip = ports.clientAddress(c);
      const limit = await ports.rateLimit({
        key: `unsubscribe:one-click:${ip ?? "unknown"}`,
        windowSeconds: 60,
        max: 10,
      });
      if (!limit.allowed) {
        return c.json({ error: "Too many requests" }, 429);
      }

      const token = c.req.query("token") ?? null;
      if (!token) {
        return c.json({ error: "Missing token" }, 400);
      }

      try {
        await ports.automation().confirmUnsubscribe({
          token,
          scope: "trigger",
        });
      } catch (err) {
        // Distinguish a bad/tampered token (4xx) from a downstream persistence
        // failure (5xx) — a DB blip must not be reported to the mail client as an
        // invalid link.
        if (err instanceof InvalidUnsubscribeTokenError) {
          return c.json({ error: "Invalid token" }, 400);
        }
        logger.error({ error: err }, "One-click unsubscribe failed");
        return c.json({ error: "Internal server error" }, 500);
      }

      logger.info("One-click unsubscribe processed");
      return c.json({ ok: true });
    });

  // RFC 8058 one-click is POST-only. Registered AFTER the POST route so that a
  // POST request resolves to the handler above; every other method falls through
  // to here for a 405 with an Allow header (matching the legacy contract) rather
  // than a bare 404.
  secured
    .access(publicEndpoint("RFC 8058 one-click unsubscribe; method guard returns 405 for non-POST"))
    .all("/unsubscribe", (c) => {
      c.header("Allow", "POST");
      return c.json({ error: "Method not allowed" }, 405);
    });

  return secured.hono;
}
