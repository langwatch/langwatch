/**
 * Playground for authoring persisted, sandboxed custom-chart widgets against
 * the real LangWatchQL endpoint. Always on in local development; anywhere
 * else it's behind release_custom_chart_playground (see the flag check
 * below) — the route in `src/routes.tsx` is registered unconditionally so
 * the flag has something to open outside dev.
 */

import { Badge } from "@chakra-ui/react";
import { useEffect } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { LoadingScreen } from "~/components/LoadingScreen";
import { NotFoundScene } from "~/components/NotFoundScene";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { CustomChartPlayground } from "~/features/custom-chart-playground/CustomChartPlayground";
import { useRegisterLangyPageContext } from "~/features/langy/LangyContext";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useCustomChartPlaygroundGate } from "./useCustomChartPlaygroundGate";

const IS_DEV = process.env.NODE_ENV === "development";

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
      "queries. Format: server/analytics/dashboardWidgetDefinition.ts",
  },
  {
    id: "dashboard:custom-chart-playground-fetch-api",
    kind: "dashboard" as const,
    label:
      "Fetch data with LW.useChartQuery(name, params) -> TanStack useQuery " +
      "shape (data, isLoading, isFetching, isError, error, status, " +
      "refetch). Never throws. LW.query() is the low-level promise it wraps.",
  },
];

/** Why LW.query will reject on this page, or undefined when LWQL is fine. */
function unavailableReasonOf(availability: {
  data: { available: boolean; reason?: string } | undefined;
  error: unknown;
}): string | undefined {
  if (availability.data && availability.data.available !== true) {
    return availability.data.reason ?? "unknown";
  }
  if (availability.error) return "availability check failed";
  return undefined;
}

function CustomChartPlaygroundPage() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const gate = useCustomChartPlaygroundGate();

  // Langy open by default on this surface, with the page named as context.
  const openPanel = useLangyStore((s) => s.openPanel);
  useEffect(() => {
    openPanel();
  }, [openPanel]);
  useRegisterLangyPageContext(LANGY_PAGE_CONTEXT);

  const availability = api.analytics.lwql.availability.useQuery(
    { projectId },
    {
      enabled: projectId.length > 0 && gate === "open",
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      staleTime: Number.POSITIVE_INFINITY,
    },
  );

  if (gate === "loading") return <LoadingScreen />;
  if (gate === "blocked") return <NotFoundScene />;

  const unavailableReason = unavailableReasonOf(availability);

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>Custom chart playground</PageLayout.Heading>
        <Badge size="sm" variant="outline" colorPalette="orange">
          {IS_DEV ? "dev only" : "preview"}
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
