/**
 * The facts about a reader and their organization that are NOT permissions.
 *
 * The session capability answers who is here, what scope this page is about and
 * what they may do. Three questions the moved settings surfaces ask fall
 * outside that: which plan the organization is on, whether the reader holds the
 * lite `EXTERNAL` membership role, and whether they administer the PLATFORM.
 * None is a grant — the first is a billing fact, the second a membership
 * column, and the third an email allowlist that is deliberately not an
 * organization permission, because folding it into one would widen it.
 *
 * Every read runs on this application's transport under the key
 * `@trpc/react-query` would have produced for the same procedure, so a read
 * here and the same read by an application hook are ONE cache entry: the
 * organization graph the shell already holds is not fetched twice, and
 * `limits.getUsage` lands on the same entry as the application's
 * `useActivePlan`.
 *
 * A feature cannot do any of this for itself — `@tanstack/react-query` is one
 * of the imports ADR-004 seals off from `src/features/*` — which is why the
 * reads live in global behaviour and reach a feature as plain values.
 */

import { trpcQueryKey } from "@langwatch/platform-api-client";
import { useQuery } from "@tanstack/react-query";
import { readPublicAppConfig } from "./public-config";
import { useUiCapabilities } from "./ui-capabilities";
import { useUiRpc } from "./ui-rpc";

export const UI_ACTIVE_PLAN_PROCEDURE = "limits.getUsage";
export const UI_ORGANIZATIONS_PROCEDURE = "organization.getAll";
export const UI_PLATFORM_ADMIN_PROCEDURE = "user.isAdmin";

/** The organization role that reads every settings page and writes none of them. */
export const UI_LITE_MEMBER_ROLE = "EXTERNAL";

/** A plan does not change while a reader is on a settings page. */
const PLAN_STALE_TIME_MS = 5 * 60_000;

type ActivePlanRead = { activePlan?: { type?: string } };
type OrganizationsRead = ReadonlyArray<{
  id: string;
  members?: ReadonlyArray<{ role?: string }>;
}>;

/**
 * Whether this deployment is the hosted product.
 *
 * It decides one thing in the menu: Subscription on SaaS, License everywhere
 * else. A composition whose HTML shell carries no config is a self-hosted
 * deployment as far as that choice goes, never a crash — the same shape
 * `readUiDemoProjectSlug` takes for the same reason.
 */
export function readUiIsSaaS(documentRoot?: Parameters<typeof readPublicAppConfig>[0]): boolean {
  try {
    return (
      (documentRoot ? readPublicAppConfig(documentRoot) : readPublicAppConfig()).deployment ===
      "saas"
    );
  } catch {
    return false;
  }
}

export type UiOrganizationFacts = {
  /** Enterprise, or self-hosted, which resolves to enterprise. */
  isEnterprise: boolean;
  /** True while the plan is still arriving, so the menu does not shed entries. */
  isPlanLoading: boolean;
  isLiteMember: boolean;
  isSaaS: boolean;
};

/**
 * The plan tier and the membership role, for the scope this page is about.
 *
 * `limits.getUsage` is asked only where the platform hook asked it: with an
 * organization in scope and `organization:view` held. Without it the plan reads
 * as not-enterprise and not-loading, which is what the hook returned too.
 */
export function useUiOrganizationFacts(): UiOrganizationFacts {
  const { session } = useUiCapabilities();
  const rpc = useUiRpc();
  const { organizationId } = session.activeScope();
  const mayReadPlan = organizationId !== null && session.hasPermission("organization:view");

  const planInput = { organizationId: organizationId ?? "" };
  const plan = useQuery({
    queryKey: trpcQueryKey(UI_ACTIVE_PLAN_PROCEDURE, { input: planInput, type: "query" }),
    queryFn: () => rpc.query(UI_ACTIVE_PLAN_PROCEDURE, planInput) as Promise<ActivePlanRead>,
    enabled: mayReadPlan,
    retry: false,
    staleTime: PLAN_STALE_TIME_MS,
  });

  const organizationsInput = { isDemo: false };
  const organizations = useQuery({
    queryKey: trpcQueryKey(UI_ORGANIZATIONS_PROCEDURE, {
      input: organizationsInput,
      type: "query",
    }),
    queryFn: () =>
      rpc.query(UI_ORGANIZATIONS_PROCEDURE, organizationsInput) as Promise<OrganizationsRead>,
    enabled: organizationId !== null,
    staleTime: PLAN_STALE_TIME_MS,
  });

  // `organization.getAll` narrows `members` to the caller's own row, so the
  // first member of the organization in scope IS the reader's membership.
  const role = (organizations.data ?? []).find((organization) => organization.id === organizationId)
    ?.members?.[0]?.role;

  return {
    isEnterprise: plan.data?.activePlan?.type === "ENTERPRISE",
    isPlanLoading: mayReadPlan && plan.isLoading,
    isLiteMember: role === UI_LITE_MEMBER_ROLE,
    isSaaS: readUiIsSaaS(),
  };
}

/**
 * Whether the reader administers the PLATFORM.
 *
 * `user.isAdmin` is an email allowlist rather than an organization grant, so it
 * has no permission to read it off and is asked directly. It decides only which
 * options a surface OFFERS; every route that acts on it authorizes the
 * capability again, so a stale `true` widens a menu and never an outcome.
 */
export function useUiPlatformAdmin(): boolean {
  const rpc = useUiRpc();
  const input = {};
  const query = useQuery({
    queryKey: trpcQueryKey(UI_PLATFORM_ADMIN_PROCEDURE, { input, type: "query" }),
    queryFn: () => rpc.query(UI_PLATFORM_ADMIN_PROCEDURE, input) as Promise<{ isAdmin?: boolean }>,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: PLAN_STALE_TIME_MS,
  });
  return query.data?.isAdmin ?? false;
}
