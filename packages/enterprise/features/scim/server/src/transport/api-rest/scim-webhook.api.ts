// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ScimService } from "@langwatch/enterprise-scim-contract";
import { z } from "zod";

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

const scimWebhookEventSchema = scimWebhookPayloadSchema.extend({
  data: scimWebhookPayloadSchema.optional(),
});

type ScimWebhookEvent = z.infer<typeof scimWebhookEventSchema>;
type ScimWebhookPayload = z.infer<typeof scimWebhookPayloadSchema>;

/** Auth0's SCIM Log Stream adapter; its payload is untyped at the boundary. */
export class ScimWebhookApi {
  private constructor() {}

  static create(): ScimWebhookApi {
    return new ScimWebhookApi();
  }

  async handle(input: {
    service: ScimService;
    /**
     * The tenant, resolved from the credential that authenticated the delivery.
     * Never derived from the payload: an e-mail domain in the body would let one
     * secret provision into every organization that claims that domain.
     */
    organizationId: string;
    events: unknown[];
  }): Promise<void> {
    for (const candidate of input.events) {
      const parsed = scimWebhookEventSchema.safeParse(candidate);
      if (!parsed.success || !isScimEvent(parsed.data)) {
        continue;
      }

      const event = parsed.data;
      const email = extractEmail(event);
      if (!email) {
        continue;
      }

      if (extractAction(event) === "create") {
        const name = extractName(event) ?? email.split("@")[0] ?? email;
        await input.service.createUser({
          organizationId: input.organizationId,
          request: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
            userName: email,
            name: parseName(name),
          },
        });
      } else if (extractAction(event) === "deactivate") {
        const users = await input.service.listUsers({
          organizationId: input.organizationId,
          filter: `userName eq "${email}"`,
          startIndex: 1,
          count: 1,
        });
        const user = users.Resources[0];
        if (user) {
          await input.service.deleteUser({
            organizationId: input.organizationId,
            id: user.id,
          });
        }
      }
    }
  }
}

function payloadOf(event: ScimWebhookEvent): ScimWebhookPayload {
  return event.data ?? event;
}

function isScimEvent(event: ScimWebhookEvent): boolean {
  return event.type === "sscim" || event.data?.type === "sscim";
}

function extractEmail(event: ScimWebhookEvent): string | null {
  const data = payloadOf(event);
  return data.details?.userName ?? data.details?.body?.userName ?? data.user_name ?? null;
}

function extractName(event: ScimWebhookEvent): string | null {
  const name = payloadOf(event).details?.body?.name;
  const parts = [name?.givenName, name?.familyName].filter(
    (part): part is string => part !== void 0 && part.length > 0,
  );
  return parts.length > 0 ? parts.join(" ") : null;
}

function extractAction(event: ScimWebhookEvent): "create" | "deactivate" | null {
  const data = payloadOf(event);
  const description = data.description?.toLowerCase() ?? "";
  if (description.includes("delete") || description.includes("deactivat")) {
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
