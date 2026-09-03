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

import type { ApiKeyService } from "@langwatch/api-key-contract";
import { HandledError, NotFoundError } from "@langwatch/handled-error";
import type { Context, Env, Next } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { internalSecret } from "@langwatch/api";
import {
  type AppRestManagementAuditPort,
  type AppRestSecurity,
  type SecuredApp,
  validator as zValidator,
} from "@langwatch/api/rest";
import {
  CREATE_ORGANIZATION,
  GET_ORGANIZATION,
  LIST_ORGANIZATIONS,
} from "./organization-provisioning.openapi";

/** One organization as the instance-admin surface reports it. */
export interface OrganizationProvisioningSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
}

/**
 * The organization capability this family needs, which is not the one the
 * `OrganizationService` contract publishes.
 *
 * Provisioning is the instance's surface, not a tenant's: it creates an
 * organization before any credential for it exists, reads the instance's
 * whole roster, and compensates a half-finished run by removing what it made.
 * None of those are on the contract today, so the port names exactly the four
 * the family calls. They belong on `OrganizationService` — moving them there
 * is a change to the organization package, not to a transport move.
 */
export interface OrganizationProvisioningPort {
  createForProvisioning(input: {
    name: string;
    slug?: string;
  }): Promise<{ organization: { id: string; name: string }; team: unknown }>;
  listProvisioningSummaries(): Promise<OrganizationProvisioningSummary[]>;
  getProvisioningSummary(organizationId: string): Promise<OrganizationProvisioningSummary | null>;
  deleteProvisionedOrganization(input: { organizationId: string }): Promise<void>;
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

function isAuthorized(authorizationHeader: string | undefined, expected: string): boolean {
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
 *
 * Both facts are read per request rather than captured at mount: a deployment
 * (or a test) that sets the variable after boot is honoured, and blank counts
 * as unset. The same variable is declared in the env schema for validation
 * and documentation.
 */
export function verifyInstanceAdminKey(options: {
  instanceAdminKey: () => string | undefined;
  isSaas: () => boolean;
}): (c: Context, next: Next) => Promise<Response | void> {
  return async (c, next) => {
    const configured = options.instanceAdminKey();
    if (!configured) return c.notFound();
    if (options.isSaas()) return c.notFound();

    const authorization = c.req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      throw new InstanceAdminRefusedError("missing_credentials");
    }
    if (!isAuthorized(authorization, configured)) {
      throw new InstanceAdminRefusedError("invalid_credentials");
    }
    // Returned rather than awaited so every path of a `Promise<Response | void>`
    // returns one; `noImplicitReturns` reads the fall-through as a missing
    // answer, and a middleware that short-circuits on some paths and not
    // others is exactly where that matters.
    return next();
  };
}

const createOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(255),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be lowercase letters, numbers and single hyphens")
    .optional(),
  adminApiKeyName: z.string().trim().min(1).max(100).optional(),
});

const instanceAdminPolicy = () =>
  internalSecret(
    "instance administrator bearer key (LANGWATCH_INSTANCE_ADMIN_API_KEY) " +
      "verified constant-time by the verifySecret chain; the family answers " +
      "404 when the key is not configured or the deployment is SaaS",
  );

export function createOrganizationsRestApp(options: {
  security: AppRestSecurity;
  /**
   * Resolved per request, as reading them off the Hono context used to be:
   * mounting a family must not force its services to be constructed, which is
   * what lets the OpenAPI spec generator build this app with none.
   */
  organizations: () => OrganizationProvisioningPort;
  apiKeys: () => ApiKeyService;
  /** The configured instance credential, or undefined when unset or blank. */
  instanceAdminKey: () => string | undefined;
  /** Whether this deployment is the hosted product rather than self-hosted. */
  isSaas: () => boolean;
  audit: AppRestManagementAuditPort;
  /**
   * A compensation that itself failed. The caller must see the ORIGINAL
   * failure, so this one is only reported — never raised over the top of it.
   */
  reportError: (error: Error) => void;
}): SecuredApp<Env> {
  const { security, organizations, apiKeys, audit, reportError } = options;

  const secured = security.createServiceApp({
    basePath: "/api/organizations",
    verifySecret: verifyInstanceAdminKey({
      instanceAdminKey: options.instanceAdminKey,
      isSaas: options.isSaas,
    }),
    // Enforced as a shared secret, published as a credential: the operator who
    // sets LANGWATCH_INSTANCE_ADMIN_API_KEY is the caller, and the document
    // declares `instance_admin_key` for exactly that. Left at the service app's
    // default the family would classify as `internal`, which the spec generator
    // refuses to advertise, and rightly so for a secret nobody outside the
    // deployment holds.
    credentialClass: "instance_admin_api_key",
  });

  secured
    .access(instanceAdminPolicy())
    .post(
      "/",
      describeRoute(CREATE_ORGANIZATION),
      zValidator("json", createOrganizationSchema),
      async (c) => {
        const body = c.req.valid("json");
        const service = organizations();

        const created = await service.createForProvisioning({
          name: body.name,
          ...(body.slug !== undefined ? { slug: body.slug } : {}),
        });

        let adminKey: Awaited<ReturnType<ApiKeyService["create"]>>;
        let summary: OrganizationProvisioningSummary | null;
        try {
          // The bootstrap credential: an org-scoped service key with an
          // explicit ORGANIZATION-ADMIN binding, so provisioning can continue
          // through the management APIs without a browser step.
          adminKey = await apiKeys().create({
            name: body.adminApiKeyName ?? "Provisioning admin",
            userId: null,
            createdByUserId: null,
            organizationId: created.organization.id,
            permissionMode: "all",
            bindings: [
              {
                role: "ADMIN",
                scopeType: "ORGANIZATION",
                scopeId: created.organization.id,
              },
            ],
          });

          summary = await service.getProvisioningSummary(created.organization.id);
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
            await service.deleteProvisionedOrganization({
              organizationId: created.organization.id,
            });
          } catch (compensationError) {
            reportError(
              compensationError instanceof Error
                ? compensationError
                : new Error(String(compensationError)),
            );
          }
          throw error;
        }

        audit({
          userId: "instance-admin",
          organizationId: created.organization.id,
          action: "management.organization.provision",
          args: {
            name: body.name,
            adminApiKeyId: adminKey.apiKey.id,
          },
        });

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

  secured.access(instanceAdminPolicy()).get("/", describeRoute(LIST_ORGANIZATIONS), async (c) => {
    const summaries = await organizations().listProvisioningSummaries();
    return c.json({ organizations: summaries });
  });

  secured.access(instanceAdminPolicy()).get("/:id", describeRoute(GET_ORGANIZATION), async (c) => {
    const { id } = c.req.param();
    const organization = await organizations().getProvisioningSummary(id);
    if (!organization) {
      throw new NotFoundError("not_found", "Organization", id);
    }
    return c.json({ organization });
  });

  return secured;
}
