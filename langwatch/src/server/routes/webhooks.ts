/**
 * Hono routes for webhook endpoints.
 *
 * Replaces POST /api/webhooks/auth0-scim
 *
 * Receives Auth0 Log Stream webhook events for SCIM provisioning.
 * Auth0 sends `sscim` (Successful SCIM Operation) events when a user
 * is created, updated, or deleted via SCIM on an enterprise connection.
 */
import { Hono } from "hono";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import { tracerMiddleware } from "~/app/api/middleware/tracer";
import { env } from "~/env.mjs";
import { prisma } from "~/server/db";
import { extractEmailDomain } from "~/server/better-auth/sso";
import { ScimService } from "~/server/scim/scim.service";

export const app = new Hono().basePath("/api/webhooks");
app.use(tracerMiddleware({ name: "webhooks" }));
app.use(loggerMiddleware());

app.post("/auth0-scim", async (c) => {
  const secret = env.AUTH0_SCIM_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ error: "Webhook not configured" }, { status: 404 });
  }

  const authHeader = c.req.header("authorization");
  if (authHeader !== secret) {
    return c.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const events = Array.isArray(body) ? body : [body];

  const scimService = ScimService.create(prisma);

  for (const event of events) {
    if (!isScimEvent(event)) continue;

    const email = extractEmail(event);
    if (!email) continue;

    const domain = extractEmailDomain(email);
    if (!domain) continue;

    const org = await prisma.organization.findUnique({
      where: { ssoDomain: domain },
    });
    if (!org) continue;

    const action = extractAction(event);

    if (action === "create") {
      const name = extractName(event) ?? email.split("@")[0] ?? email;
      await scimService.createUser({
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: email,
          name: parseName(name),
        },
        organizationId: org.id,
      });
    } else if (action === "deactivate") {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        await scimService.deleteUser({
          id: user.id,
          organizationId: org.id,
        });
      }
    }
  }

  return c.json({ received: true });
});

// ── helpers ──────────────────────────────────────────────────────────

function isScimEvent(event: Record<string, unknown>): boolean {
  return (
    event.type === "sscim" ||
    (typeof event.data === "object" &&
      event.data !== null &&
      (event.data as Record<string, unknown>).type === "sscim")
  );
}

function extractEmail(event: Record<string, unknown>): string | null {
  const data = (event.data ?? event) as Record<string, unknown>;
  const details = data.details as Record<string, unknown> | undefined;

  if (details?.userName && typeof details.userName === "string") {
    return details.userName;
  }

  if (details?.body && typeof details.body === "object") {
    const body = details.body as Record<string, unknown>;
    if (typeof body.userName === "string") return body.userName;
  }

  if (typeof data.user_name === "string") return data.user_name;

  return null;
}

function extractName(event: Record<string, unknown>): string | null {
  const data = (event.data ?? event) as Record<string, unknown>;
  const details = data.details as Record<string, unknown> | undefined;

  if (details?.body && typeof details.body === "object") {
    const body = details.body as Record<string, unknown>;
    if (body.name && typeof body.name === "object") {
      const name = body.name as Record<string, string>;
      const parts = [name.givenName, name.familyName].filter(Boolean);
      if (parts.length > 0) return parts.join(" ");
    }
  }

  return null;
}

function extractAction(
  event: Record<string, unknown>,
): "create" | "deactivate" | "unknown" {
  const data = (event.data ?? event) as Record<string, unknown>;
  const details = data.details as Record<string, unknown> | undefined;
  const method =
    (details?.method as string) ?? (data.description as string) ?? "";

  if (method.toLowerCase().includes("post") || method.includes("Create")) {
    return "create";
  }
  if (method.toLowerCase().includes("delete")) {
    return "deactivate";
  }

  const description = (data.description as string) ?? "";
  if (description.toLowerCase().includes("create")) return "create";
  if (
    description.toLowerCase().includes("delete") ||
    description.toLowerCase().includes("deactivate")
  ) {
    return "deactivate";
  }

  return "unknown";
}

function parseName(
  fullName: string,
): { givenName?: string; familyName?: string } | undefined {
  const spaceIndex = fullName.indexOf(" ");
  if (spaceIndex === -1) return { givenName: fullName };
  return {
    givenName: fullName.substring(0, spaceIndex),
    familyName: fullName.substring(spaceIndex + 1),
  };
}
