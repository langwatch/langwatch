/**
 * The things several REST families dispatch through that belong to the
 * PROCESS rather than to any one feature.
 *
 * Each was a module-level singleton in the platform application, reading an
 * environment module or a global service graph. Here each is built from
 * something the composition already holds — the organization service, the
 * validated public origin, the database client's own error shapes — so a
 * second process (or a test) mounts the same families against different
 * facts without touching a family.
 */
import { HandledError } from "@langwatch/handled-error";
import type { MiddlewareHandler } from "hono";
import { TeamNotFoundError, type OrganizationService } from "@langwatch/organization-contract";
import type { PlatformUrlBuilder } from "@langwatch/api/rest";

/**
 * Resolves the credential's project to its organization and puts it on the
 * request context.
 *
 * Applied per route AFTER the access chain, which is what sets `project`. The
 * two 500 bodies are transcribed from the middleware this replaces: a family
 * that mounted it without a project, and a project whose team has no
 * organization row, are both this process's own defects rather than the
 * caller's, and both said so in exactly these words.
 */
export function createOrganizationMiddleware(
  organizations: () => Pick<OrganizationService, "getTeamById">,
): MiddlewareHandler {
  return async (c, next): Promise<Response | undefined> => {
    const project = c.get("project") as { teamId: string } | undefined;
    if (!project) {
      return c.json(
        {
          error: "Internal Server Error",
          message: "Trying to use organization middleware without project",
        },
        500,
      );
    }

    try {
      const team = await organizations().getTeamById({ teamId: project.teamId });
      c.set("organization", { id: team.organizationId });
    } catch (error) {
      if (!(error instanceof TeamNotFoundError)) throw error;
      return c.json({ error: "Internal Server Error", message: "Organization not found" }, 500);
    }

    await next();
    return undefined;
  };
}

/**
 * Deep links back into the product, built from the deployment's public origin.
 *
 * An unset origin yields a path-only link rather than a refusal: the link is
 * an affordance on a response whose payload is already correct, and failing a
 * read because a convenience field cannot be absolute would be the wrong
 * trade. This is the behaviour the builder it replaces had — `BASE_HOST` was
 * optional there too, and an unset value produced exactly `/slug/path`.
 */
export function createPlatformUrlBuilder(publicBaseUrl: string | undefined): PlatformUrlBuilder {
  const base = (publicBaseUrl ?? "").replace(/\/+$/, "");
  return ({ projectSlug, path }) => {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${base}/${projectSlug}${cleanPath}`;
  };
}

/**
 * The columns a database unique-constraint violation names, or an empty list
 * when the failure is not one.
 *
 * Duck-typed rather than `instanceof`: bundlers can produce two copies of the
 * driver's error class, and both error SHAPES are live — the classic engine
 * put field names (or an index name) on `meta.target`, the Prisma 7 driver
 * adapters put them on `meta.driverAdapterError.cause.constraint`. The
 * adapter quotes identifiers the way Postgres does, so the quoting is stripped
 * and callers match plain field names either way.
 */
export function uniqueConstraintTargets(error: unknown): string[] {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    (error as { code: unknown }).code !== "P2002"
  ) {
    return [];
  }
  const dequote = (value: unknown) => String(value).replace(/^"(.*)"$/, "$1");
  const meta = (error as { meta?: Record<string, unknown> }).meta;
  const target = meta?.target;
  if (Array.isArray(target)) return target.map(dequote);
  if (typeof target === "string") return [dequote(target)];
  const constraint = (
    meta?.driverAdapterError as
      | { cause?: { constraint?: { fields?: unknown; index?: unknown } } }
      | undefined
  )?.cause?.constraint;
  if (Array.isArray(constraint?.fields)) return constraint.fields.map(dequote);
  if (typeof constraint?.index === "string") return [dequote(constraint.index)];
  return [];
}

/**
 * The refusal a REST family answers with when the capability behind one of its
 * routes is not composed on this process.
 *
 * 503 with `service_unavailable` rather than a 500 or an empty success: the
 * caller is told this deployment cannot answer, which is actionable, instead
 * of being handed a result that looks like an answer. Each composition in this
 * process declares its own module-private copy of this error for the same
 * reason; this one is the REST mounts' shared copy because they are one door.
 */
export class ApiRestCapabilityUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiRestCapabilityUnavailableError";
  }
}
