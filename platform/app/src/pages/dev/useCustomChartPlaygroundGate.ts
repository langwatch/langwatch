import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { NOT_TARGETED } from "~/server/featureFlag/targeting";

const IS_DEV = process.env.NODE_ENV === "development";

/**
 * Whether the custom-chart-playground page may render right now.
 *
 * "open" always in local development, with no flag query fired at all.
 * Everywhere else it is `release_custom_chart_playground`, resolved the
 * same "wait for both org and flag to settle" way `withFeatureFlagGuard`
 * does: answering "blocked" the instant the flag query is disabled (before
 * the org resolves) would flash a 404 on every load for a project that
 * actually has the flag on.
 */
export type CustomChartPlaygroundGateState = "loading" | "blocked" | "open";

export function useCustomChartPlaygroundGate(): CustomChartPlaygroundGateState {
  const {
    project,
    organization,
    isLoading: orgLoading,
  } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const organizationId = organization?.id ?? "";

  const { enabled, isLoading: flagLoading } = useFeatureFlag(
    "release_custom_chart_playground",
    {
      projectId: projectId || NOT_TARGETED,
      organizationId: organizationId || NOT_TARGETED,
      enabled: !IS_DEV && !!organizationId,
    },
  );

  if (IS_DEV) return "open";
  if (orgLoading || flagLoading) return "loading";
  return enabled ? "open" : "blocked";
}
