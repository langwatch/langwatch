import { type APIRequestContext } from "@playwright/test";
import { trpcMutation, trpcQuery } from "./trpc";

/**
 * Per-test tenant provisioning.
 *
 * Every headless test gets its own user, organisation, team and project. This
 * is a rule of the harness, not a convenience: the suite used to run one test
 * at a time because everything shared a single organisation, and the members
 * tests toggled an enterprise licence on it — a licence window that leaked
 * into any test asserting the Free plan. Isolating the tenant is what makes
 * `fullyParallel` safe.
 *
 * Provisioning is pure HTTP. Playwright's `request` fixture is already
 * isolated per test and carries its own cookie jar, so signing in on it makes
 * every subsequent tRPC call in that test authenticated as this user.
 *
 * See specs/ci/e2e-tiers.feature.
 */

export type Tenant = {
  email: string;
  password: string;
  organizationId: string;
  teamId: string;
  projectId: string;
  projectSlug: string;
  /** Legacy project key, valid in `X-Auth-Token` for the REST API. */
  apiKey: string;
};

type OrganizationsResponse = Array<{
  id: string;
  teams: Array<{
    id: string;
    projects: Array<{ id: string; slug: string }>;
  }>;
}>;

/**
 * Unique per test, and readable in the database when something goes wrong.
 * Playwright gives each worker a stable index; the timestamp and random
 * suffix keep two runs on the same worker from colliding.
 */
function uniqueSuffix(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${random}`;
}

async function signIn(
  request: APIRequestContext,
  { email, password }: { email: string; password: string },
): Promise<void> {
  const response = await request.post("/api/auth/sign-in/email", {
    data: { email, password },
  });

  if (!response.ok()) {
    throw new Error(
      `Sign-in failed for ${email} (${response.status()}): ${(await response.text()).slice(0, 300)}`,
    );
  }
}

export async function provisionTenant(
  request: APIRequestContext,
  { label = "e2e" }: { label?: string } = {},
): Promise<Tenant> {
  const suffix = uniqueSuffix();
  const email = `e2e-${label}-${suffix}@langwatch.test`;
  const password = `E2ePassw0rd!${suffix}`;

  await trpcMutation(request, "user.register", {
    name: `E2E ${label} ${suffix}`,
    email,
    password,
  });

  await signIn(request, { email, password });

  // `primaryIntent: "AGENT_GOVERNANCE"` skips project creation entirely, so we
  // leave it unset and let the default LLM-ops path build the project.
  await trpcMutation(request, "onboarding.initializeOrganization", {
    orgName: `E2E Org ${suffix}`,
    projectName: `E2E Project ${suffix}`,
    language: "other",
    framework: "other",
  });

  const organizations = await trpcQuery<OrganizationsResponse>(
    request,
    "organization.getAll",
  );

  const organization = organizations[0];
  const team = organization?.teams?.[0];
  const project = team?.projects?.[0];

  if (!organization || !team || !project) {
    throw new Error(
      `Provisioning produced no project for ${email}: ${JSON.stringify(organizations).slice(0, 400)}`,
    );
  }

  const { apiKey } = await trpcQuery<{ apiKey: string }>(
    request,
    "project.getProjectAPIKey",
    { projectId: project.id },
  );

  return {
    email,
    password,
    organizationId: organization.id,
    teamId: team.id,
    projectId: project.id,
    projectSlug: project.slug,
    apiKey,
  };
}
