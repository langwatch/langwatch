/**
 * Instance-administrator organization provisioning, self-hosted only.
 *
 * The one management surface that exists before any organization does, so it
 * authenticates against the instance (the `LANGWATCH_INSTANCE_ADMIN_API_KEY`
 * bearer credential) rather than an organization key, and it is deliberately a
 * plain SecuredApp rather than an `@langwatch/api` service: there is no
 * organization to resolve, no plan to gate on, and no RBAC principal.
 *
 * Availability is a per-request property: when the credential is not
 * configured, or the deployment is SaaS, every path answers 404: the family
 * is absent, not forbidden. The routes stay mounted and policy-registered
 * either way, so the route-policy registry and the composed router can never
 * disagree about them, and the OpenAPI document (which describes the
 * self-hosted capability) can be generated without the credential.
 *
 * Creating an organization returns an organization-scoped admin API key so
 * infrastructure-as-code can chain: instance key creates the organization,
 * the returned key does everything else through the management APIs.
 */
import { timingSafeEqual } from "node:crypto";
import { auditLog } from "~/runtime/app/features/audit-log";
import { HandledError, NotFoundError } from "@langwatch/handled-error";
import type { Context, Next } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { RoleBindingScopeType, TeamUserRole } from "~/generated/prisma/client";
import { createServiceApp, internalSecret } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { getApp } from "~/server/app-layer/app";
import { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "~/server/app-layer/organizations/repositories/organization.prisma.repository";
import { prisma } from "~/server/db";
import { PromptTagRepository } from "~/server/prompt-config/repositories/prompt-tag.repository";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import {
  CREATE_ORGANIZATION,
  GET_ORGANIZATION,
  LIST_ORGANIZATIONS,
} from "./openapi";

/**
 * The configured instance credential, read per request so a deployment (or a
 * test) that sets it after boot is honoured; blank counts as unset. The same
 * variable is declared in the env schema for validation and documentation.
 */
function instanceAdminKey(): string | undefined {
  const key = process.env.LANGWATCH_INSTANCE_ADMIN_API_KEY?.trim();
  return key ? key : undefined;
}

/**
 * The instance credential was absent or wrong.
 *
 * A handled error rather than a hand-rolled body, so `createServiceApp`'s
 * error handler serialises it like every other refusal on the surface and the
 * caller reads a stable `code` instead of an HTTP phrase. The two cases stay
 * apart because they need different answers: nothing presented means "set
 * LANGWATCH_INSTANCE_ADMIN_API_KEY, or pass --instance-key"; a wrong value
 * means the credential itself is not the instance's.
 */
class InstanceAdminRefusedError extends HandledError {
  constructor(code: "missing_credentials" | "invalid_credentials") {
    super(
      code,
      code === "missing_credentials"
        ? "This request carried no instance administrator credential"
        : "That is not this instance's administrator credential",
      { httpStatus: 401, fault: "customer" },
    );
    this.name = "InstanceAdminRefusedError";
  }
}

function isAuthorized(
  authorizationHeader: string | undefined,
  expected: string,
): boolean {
  if (!authorizationHeader?.startsWith("Bearer ")) return false;
  const presented = Buffer.from(authorizationHeader.slice("Bearer ".length));
  const expectedBuffer = Buffer.from(expected);
  if (presented.length !== expectedBuffer.length) return false;
  return timingSafeEqual(presented, expectedBuffer);
}

/**
 * Constant-time bearer check against the instance credential (the
 * langy-internal pattern: a plain `===` leaks the secret one byte at a time
 * to anything that can time responses). Availability comes first: an
 * unconfigured credential or a SaaS deployment means the family does not
 * exist, so the answer is 404 before any credential is examined.
 */
export async function verifyInstanceAdminKey(c: Context, next: Next) {
  const configured = instanceAdminKey();
  if (!configured) return c.notFound();
  if (getApp().config.isSaas) return c.notFound();

  const authorization = c.req.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new InstanceAdminRefusedError("missing_credentials");
  }
  if (!isAuthorized(authorization, configured)) {
    throw new InstanceAdminRefusedError("invalid_credentials");
  }
  await next();
}

const createOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(255),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "must be lowercase letters, numbers and single hyphens",
    )
    .optional(),
  adminApiKeyName: z.string().trim().min(1).max(100).optional(),
});

const organizationService = () =>
  new OrganizationService(
    new PrismaOrganizationRepository(prisma),
    new PromptTagRepository(prisma),
  );

const secured = createServiceApp({
  basePath: "/api/organizations",
  verifySecret: verifyInstanceAdminKey,
  // Enforced as a shared secret, published as a credential: the operator who
  // sets LANGWATCH_INSTANCE_ADMIN_API_KEY is the caller, and the document
  // declares `instance_admin_key` for exactly that. Left at the service app's
  // default the family would classify as `internal`, which the spec generator
  // refuses to advertise, and rightly so for a secret nobody outside the
  // deployment holds.
  credentialClass: "instance_admin_api_key",
});

const instanceAdminPolicy = () =>
  internalSecret(
    "instance administrator bearer key (LANGWATCH_INSTANCE_ADMIN_API_KEY) " +
      "verified constant-time by the verifySecret chain; the family answers " +
      "404 when the key is not configured or the deployment is SaaS",
  );

secured
  .access(instanceAdminPolicy())
  .post(
    "/",
    describeRoute(CREATE_ORGANIZATION),
    zValidator("json", createOrganizationSchema),
    async (c) => {
      const body = c.req.valid("json");

      const created = await organizationService().createForProvisioning({
        name: body.name,
        ...(body.slug !== undefined ? { slug: body.slug } : {}),
      });

      let adminKey: Awaited<ReturnType<ApiKeyService["create"]>>;
      let summary: Awaited<
        ReturnType<OrganizationService["getProvisioningSummary"]>
      >;
      try {
        // The bootstrap credential: an org-scoped service key with an explicit
        // ORGANIZATION-ADMIN binding, so provisioning can continue through the
        // management APIs without a browser step.
        adminKey = await ApiKeyService.create(prisma).create({
          name: body.adminApiKeyName ?? "Provisioning admin",
          userId: null,
          createdByUserId: null,
          organizationId: created.organization.id,
          permissionMode: "all",
          bindings: [
            {
              role: TeamUserRole.ADMIN,
              scopeType: RoleBindingScopeType.ORGANIZATION,
              scopeId: created.organization.id,
            },
          ],
        });

        summary = await organizationService().getProvisioningSummary(
          created.organization.id,
        );
        if (!summary) {
          // The slug is the natural key an infrastructure-as-code caller
          // stores; answering 201 with a blank one moves the failure far
          // from its cause.
          throw new Error(
            `provisioned organization ${created.organization.id} could not be read back`,
          );
        }
      } catch (error) {
        // Compensate: without its bootstrap key the organization is
        // unreachable, and the slug would squat every retry as a 409. The
        // caller must see the original failure, so a failed compensation is
        // only reported.
        try {
          await organizationService().deleteProvisionedOrganization({
            organizationId: created.organization.id,
          });
        } catch (compensationError) {
          captureException(toError(compensationError));
        }
        throw error;
      }

      // Fire-and-forget like every other management audit, but with the
      // rejection handled: `void` alone silences the lint rule and leaves an
      // unhandled rejection when the audit insert fails.
      void auditLog({
        userId: "instance-admin",
        organizationId: created.organization.id,
        action: "management.organization.provision",
        args: {
          name: body.name,
          adminApiKeyId: adminKey.apiKey.id,
        },
      }).catch((error) => captureException(toError(error)));

      return c.json(
        {
          organization: {
            id: created.organization.id,
            name: created.organization.name,
            slug: summary.slug,
          },
          team: created.team,
          adminApiKey: { id: adminKey.apiKey.id, token: adminKey.token },
        },
        201,
      );
    },
  );

secured
  .access(instanceAdminPolicy())
  .get("/", describeRoute(LIST_ORGANIZATIONS), async (c) => {
    const organizations =
      await organizationService().listProvisioningSummaries();
    return c.json({ organizations });
  });

secured
  .access(instanceAdminPolicy())
  .get("/:id", describeRoute(GET_ORGANIZATION), async (c) => {
    const { id } = c.req.param();
    const organization = await organizationService().getProvisioningSummary(id);
    if (!organization) {
      throw new NotFoundError("not_found", "Organization", id);
    }
    return c.json({ organization });
  });

export const app = secured.hono;
