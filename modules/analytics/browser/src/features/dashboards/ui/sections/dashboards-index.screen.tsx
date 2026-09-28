/** `/[project]/dashboards` has no page of its own: it forwards to the member's landing board. */

import { UiPageLoading } from "@langwatch/ui-kernel/page-fallbacks";
import { useEffect } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { dashboardsPath, landingBoardId } from "../../model/boards.ts";
import { DashboardsGate } from "./dashboards-gate.tsx";

function LandingRedirect() {
  const host = useAnalyticsHost();
  const projectSlug = host.project()?.slug;

  useEffect(() => {
    if (!projectSlug) return;
    host.navigate(dashboardsPath({ projectSlug, dashboardId: landingBoardId() }), {
      replace: true,
    });
  }, [host, projectSlug]);

  return <UiPageLoading />;
}

export default function DashboardsIndexScreen() {
  return (
    <DashboardsGate>
      <LandingRedirect />
    </DashboardsGate>
  );
}
