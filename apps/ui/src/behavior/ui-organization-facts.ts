/**
 * Facts about a reader and their organization that are NOT permissions:
 * plan tier, `EXTERNAL` lite-member role, PLATFORM admin (an allowlist,
 * deliberately not an org permission) — cached under `trpcQueryKey`.
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
 * Whether this deployment is the hosted product — decides one menu
 * entry, Subscription vs License. No config reads as self-hosted, never
 * a crash, the same shape `readUiDemoProjectSlug` takes.
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
 * The plan tier and membership role — `limits.getUsage` is asked only
 * with an organization in scope and `organization:view` held; otherwise
 * the plan reads as not-enterprise and not-loading.
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
 * `user.isAdmin` is an email allowlist, not an org grant, asked directly
 * — it only decides which options a surface OFFERS; every route that
 * acts re-authorizes, so a stale `true` widens a menu, never an outcome.
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
