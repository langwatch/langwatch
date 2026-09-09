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
import {
  type AppRestSecurity,
  HttpError,
  MANAGEMENT_API_VERSION,
  type EndpointVariables,
  type MountableRestApp,
  type ServiceContext,
} from "@langwatch/api/rest";

import { ScimWebhookApi } from "./scim-webhook.api.ts";
import type { ScimService } from "@langwatch/enterprise-scim-contract";
import type { Instant } from "@langwatch/time";
import { scimWebhookAuth } from "./scim-webhook.middleware.ts";

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
  now?: () => Instant;
}>;

/** Builds the `/api/webhooks/auth0-scim` family over one process's ports. */
export function createScimWebhookRestApp(options: {
  security: AppRestSecurity;
  ports: ScimWebhookRestPorts;
}): MountableRestApp {
  const { security, ports } = options;

  const { service, policy } = security.createServiceVersionedApp({
    name: "scim-webhook",
    basePath: "/api/webhooks",
    // Auth0 holds this exact URL; a provider callback has no dated contract to
    // negotiate.
    staticGeneration: "v1",
    errorEnvelope: "legacy",
    errorHandler: () => (error, context) => {
      if (error instanceof HttpError) {
        return context.json({ error: error.error }, error.status);
      }
      throw error;
    },
  });
  const scimWebhookApi = ScimWebhookApi.create();
  const intakeHandler = async (c: ServiceContext<EndpointVariables>) => {
    await scimWebhookApi.handle({
      service: ports.scim(),
      organizationId: c.get("scimWebhookOrganizationId"),
      events: c.get("scimWebhookEvents"),
    });
    return c.json({ received: true });
  };

  return service
    .registerRoute("post", "/auth0-scim", MANAGEMENT_API_VERSION, intakeHandler, (b) =>
      policy(
        internalSecret(
          "auth0 SCIM webhook: signed with the deployment secret, tenanted by the presented SCIM token",
        ),
      )(b)
        .withMiddleware(scimWebhookAuth(ports))
        // The HMAC is computed over these exact characters.
        .withRawBody("text")
        .withRawResponse(
          "the intake keeps its own bodies: 404 for an install with no secret, 401/403 " +
            "for a refused delivery, { received: true } for an accepted one",
        ),
    )
    .build();
}
