/**
 * Dev-only playground for authoring persisted, sandboxed custom-chart widgets
 * against the real LangWatchQL endpoint. Two gates: the conditional route
 * registration in `src/routes.tsx` (chunk excluded from prod builds) and the
 * NODE_ENV check below (dead-code-eliminated in prod) — belt and suspenders.
 */

import { Badge } from "@chakra-ui/react";
import { useEffect } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { CustomChartPlayground } from "~/features/custom-chart-playground/CustomChartPlayground";
import { useRegisterLangyPageContext } from "~/features/langy/LangyContext";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

const LANGY_PAGE_CONTEXT = [
  {
    id: "dashboard:custom-chart-playground",
    kind: "dashboard" as const,
    // Describes the resource, not an instruction (chip labels are rendered
    // verbatim as page context, never as steering — see
    // langyTurnContext.schema.ts, and are capped at MAX_LABEL_LENGTH=200).
    // Names the current widget shape and where to read the full contract,
    // the same way any other resource chip names what it points at, so the
    // agent knows this page's format has moved off the raw-HTML srcdocHtml
    // shape it may have seen elsewhere in the repo's history.
    label:
      "Custom chart playground: each widget is one React/TSX file (default " +
      "export, may import react/react-dom/recharts) plus named LangWatchQL " +
      "queries. Format: server/analytics/playgroundWidgetDefinition.ts",
  },
  {
    id: "dashboard:custom-chart-playground-fetch-api",
    kind: "dashboard" as const,
    label:
      "Fetch data with LW.useChartQuery(name, params) -> {data, loading, " +
      "error}. Never throws; refetches on time-window changes. LW.query() " +
      "is the low-level promise it wraps — prefer the hook.",
  },
];

function CustomChartPlaygroundPage() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  // Langy open by default on this surface, with the page named as context.
  const openPanel = useLangyStore((s) => s.openPanel);
  useEffect(() => {
    openPanel();
  }, [openPanel]);
  useRegisterLangyPageContext(LANGY_PAGE_CONTEXT);

  const availability = api.analytics.lwql.availability.useQuery(
    { projectId },
    {
      enabled: projectId.length > 0,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      staleTime: Number.POSITIVE_INFINITY,
    },
  );

  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  const unavailableReason =
    availability.data && availability.data.available !== true
      ? (availability.data.reason ?? "unknown")
      : availability.error
        ? "availability check failed"
        : undefined;

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>Custom chart playground</PageLayout.Heading>
        <Badge size="sm" variant="outline" colorPalette="orange">
          dev only
        </Badge>
      </PageLayout.Header>
      {projectId.length > 0 && (
        <CustomChartPlayground
          key={projectId}
          projectId={projectId}
          projectSlug={project?.slug ?? ""}
          warning={
            unavailableReason !== undefined
              ? `LWQL unavailable: ${unavailableReason} — LW.query will reject`
              : undefined
          }
        />
      )}
    </DashboardLayout>
  );
}

export default withPermissionGuard("analytics:view", {
  layoutComponent: DashboardLayout,
})(CustomChartPlaygroundPage);
