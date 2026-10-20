/**
 * A fresh account, organization and project per scenario file, so one run's
 * resources never change what the next run finds. Shared by the guided and
 * the dashboards fixtures; the provider they attach lives in seed-provider.ts.
 */

import { useAccount } from "./config";
import { getSessionCookie, resetSessionCookie, signUpAccount, trpcMutate, trpcQuery } from "./trpc";

/** Where a seeded organization's one project lives. */
export interface SeededProject {
  organizationId: string;
  organizationSlug: string;
  teamId: string;
  projectId: string;
  projectSlug: string;
}

/** Signs a new account up, runs the rest of the process as it, and returns its session cookie. */
export async function signUpAndUseAccount({
  name,
  email,
  password,
}: {
  name: string;
  email: string;
  password: string;
}): Promise<string> {
  await signUpAccount({ name, email, password });
  useAccount({ email, password });
  resetSessionCookie();
  return getSessionCookie();
}

/** A new organization, its first team and one project, created as the signed-in account. */
export async function createOrganizationWithProject({
  cookie,
  orgName,
  primaryIntent,
  signUpData,
  project,
}: {
  cookie: string;
  orgName: string;
  primaryIntent: "AGENT_GOVERNANCE" | "LLM_OPS";
  signUpData: Record<string, unknown>;
  project: { name: string; language: string; framework: string };
}): Promise<SeededProject> {
  const org = await trpcMutate<{
    organization: { id: string; slug: string };
    team: { id: string; slug: string };
  }>({
    cookie,
    path: "organization.createAndAssign",
    input: { orgName, primaryIntent, signUpData },
  });
  const created = await trpcMutate<{ projectSlug: string }>({
    cookie,
    path: "project.create",
    input: { organizationId: org.organization.id, teamId: org.team.id, ...project },
  });
  // The create answers with the slug alone; the id comes from the
  // organization listing, the way the app resolves the ambient project.
  const organizations = await trpcQuery<
    {
      id: string;
      teams?: { projects?: { id: string; slug: string }[] }[];
    }[]
  >({ cookie, path: "organization.getAll", input: {} });
  const found = organizations
    .find((organization) => organization.id === org.organization.id)
    ?.teams?.flatMap((team) => team.projects ?? [])
    .find((candidate) => candidate.slug === created.projectSlug);
  if (!found) {
    throw new Error(
      `project ${created.projectSlug} was created but the organization does not list it`,
    );
  }
  return {
    organizationId: org.organization.id,
    organizationSlug: org.organization.slug,
    teamId: org.team.id,
    projectId: found.id,
    projectSlug: found.slug,
  };
}
