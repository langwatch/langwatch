// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The Auth0 SCIM log stream: whether a delivery is admitted, and what it
 * provisions once it is. Its payload is untyped at the boundary, and the replay
 * window lives here because one process remembers one set of deliveries.
 */
import type {
  ScimDeliveryAdmission,
  ScimService,
} from "@langwatch/enterprise-scim-contract";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import {
  SCIM_WEBHOOK_TOLERANCE_SECONDS,
  verifyScimWebhookSignature,
} from "../rules/scim-webhook-signature.rules.ts";

/** Deliveries already seen inside the freshness window, by their nonce. */
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

/** The bearer a delivery presented, or nothing where it presented none. */
function findBearerToken(header: string | null): string | null {
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ").trim();
  return token.length > 0 ? token : null;
}

const scimWebhookNameSchema = z.looseObject({
  givenName: z.string().optional(),
  familyName: z.string().optional(),
});

const scimWebhookBodySchema = z.looseObject({
  userName: z.string().optional(),
  name: scimWebhookNameSchema.optional(),
});

const scimWebhookDetailsSchema = z.looseObject({
  userName: z.string().optional(),
  body: scimWebhookBodySchema.optional(),
  operation: z.string().optional(),
});

const scimWebhookPayloadSchema = z.looseObject({
  type: z.string().optional(),
  details: scimWebhookDetailsSchema.optional(),
  user_name: z.string().optional(),
  description: z.string().optional(),
});

const scimWebhookEventSchema = z.looseObject({
  ...scimWebhookPayloadSchema.shape,
  data: scimWebhookPayloadSchema.optional(),
});

type ScimWebhookEvent = z.infer<typeof scimWebhookEventSchema>;
type ScimWebhookPayload = z.infer<typeof scimWebhookPayloadSchema>;

export class ScimDirectoryStreamService {
  readonly #replays = new ScimWebhookReplayWindow();

  private constructor(
    private readonly scim: ScimService,
    private readonly webhookSecret: () => string | undefined,
  ) {}

  static create({
    scim,
    webhookSecret,
  }: {
    scim: ScimService;
    webhookSecret: () => string | undefined;
  }): ScimDirectoryStreamService {
    return new ScimDirectoryStreamService(scim, webhookSecret);
  }

  /**
   * Whether this delivery provisions anything, and whose directory it
   * provisions. One question asked three ways: is it from the provider (a
   * signature over the exact bytes it sent, keyed with the deployment secret),
   * is it fresh (a timestamp inside the tolerance, and a nonce not seen
   * before), and WHOSE directory is it for? The tenant comes from the SCIM
   * token the caller presents — the same per-connection credential the
   * protocol routes authenticate with — and never from the payload, because a
   * body that can name its own organization makes one global secret authority
   * over every organization with a matching single sign-on domain.
   */
  async admit(delivery: {
    body: string;
    signature: string | null;
    authorization: string | null;
  }): Promise<ScimDeliveryAdmission> {
    const secret = this.webhookSecret();

    if (!secret) return { status: "not-configured" };

    const nowSeconds = Math.floor(nowInstant().epochMilliseconds / 1000);
    const verdict = verifyScimWebhookSignature({
      secret,
      body: delivery.body,
      header: delivery.signature ?? undefined,
      nowSeconds,
    });

    if (!verdict.verified || !this.#replays.claim(verdict.nonce, nowSeconds)) {
      return { status: "unauthorized" };
    }

    const token = findBearerToken(delivery.authorization);

    if (!token) return { status: "unauthorized" };

    const entitlement = await this.scim.verifyToken({ token });

    if (entitlement.status === "invalid_token") return { status: "unauthorized" };
    if (entitlement.status !== "ok") return { status: "forbidden" };

    const parsed = findEvents(delivery.body);

    if (!parsed) return { status: "invalid-json" };

    return { status: "admitted", organizationId: entitlement.organizationId, events: parsed };
  }

  /**
   * @param organizationId The tenant, resolved from the credential that
   * authenticated the delivery. Never derived from the payload: an e-mail
   * domain in the body would let one secret provision into every organization
   * that claims that domain.
   */
  async relay(input: { organizationId: string; events: unknown[] }): Promise<void> {
    for (const candidate of input.events) {
      const parsed = scimWebhookEventSchema.safeParse(candidate);
      if (!parsed.success || !isScimEvent(parsed.data)) {
        continue;
      }

      const event = parsed.data;
      const email = findEmail(event);
      if (!email) {
        continue;
      }

      if (findAction(event) === "create") {
        const name = findName(event) ?? email.split("@")[0] ?? email;
        await this.scim.createUser({
          organizationId: input.organizationId,
          request: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
            userName: email,
            name: parseName(name),
          },
        });
      } else if (findAction(event) === "deactivate") {
        const users = await this.scim.listUsers({
          organizationId: input.organizationId,
          filter: `userName eq "${email}"`,
          startIndex: 1,
          count: 1,
        });
        const user = users.Resources[0];
        if (user) {
          await this.scim.deleteUser({
            organizationId: input.organizationId,
            id: user.id,
          });
        }
      }
    }
  }
}

/** The delivery's events, or nothing where its body was not JSON at all. */
function findEvents(body: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(body);

    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
}

function payloadOf(event: ScimWebhookEvent): ScimWebhookPayload {
  return event.data ?? event;
}

function isScimEvent(event: ScimWebhookEvent): boolean {
  return event.type === "sscim" || event.data?.type === "sscim";
}

function findEmail(event: ScimWebhookEvent): string | null {
  const data = payloadOf(event);
  return data.details?.userName ?? data.details?.body?.userName ?? data.user_name ?? null;
}

function findName(event: ScimWebhookEvent): string | null {
  const name = payloadOf(event).details?.body?.name;
  const parts = [name?.givenName, name?.familyName].filter(
    (part): part is string => part !== void 0 && part.length > 0,
  );
  return parts.length > 0 ? parts.join(" ") : null;
}

function findAction(event: ScimWebhookEvent): "create" | "deactivate" | null {
  const data = payloadOf(event);
  const description = data.description?.toLowerCase() ?? "";
  const describesRemoval =
    description.includes("delete") || description.includes("deactivat");

  if (describesRemoval) {
    return "deactivate";
  }
  if (description.includes("create")) {
    return "create";
  }

  const operation = data.details?.operation?.toLowerCase() ?? "";
  if (operation === "delete" || operation === "deactivate") {
    return "deactivate";
  }
  return operation === "create" ? "create" : null;
}

function parseName(name: string): { givenName: string; familyName?: string } {
  const [givenName, ...rest] = name.trim().split(/\s+/);
  return {
    givenName: givenName || name,
    ...(rest.length > 0 ? { familyName: rest.join(" ") } : {}),
  };
}
