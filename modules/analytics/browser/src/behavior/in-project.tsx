/**
 * Runs what it wraps in another project than the page's: the sidebar section in the project
 * navigation named, an org-level board in the project it opens in.
 */

import {
  UiHostServicesContextProvider,
  useOptionalUiHostServices,
} from "@langwatch/browser-host/capabilities";
import type { ReactNode } from "react";

import {
  analyticsHostInProject,
  uiAnalyticsInProject,
} from "../model/analytics-host-in-project.ts";
import {
  type AnalyticsHostProject,
  AnalyticsHostProvider,
  useAnalyticsHost,
} from "../model/analytics-host.ts";

/** Scopes every read, write, grant and product event below to `project`. */
export function InProject({
  project: { id, slug, name },
  children,
}: {
  project: Pick<AnalyticsHostProject, "id" | "slug" | "name">;
  children: ReactNode;
}) {
  const host = useAnalyticsHost();
  const pageProjectId = host.project()?.id;
  const services = useOptionalUiHostServices();
  const scoped = analyticsHostInProject({ host, project: { id, slug, name } });
  const section = <AnalyticsHostProvider value={scoped}>{children}</AnalyticsHostProvider>;
  if (!services?.analytics) return section;
  const analytics = uiAnalyticsInProject({
    analytics: services.analytics,
    projectId: id,
    pageProjectId,
  });
  return (
    <UiHostServicesContextProvider value={{ ...services, analytics }}>
      {section}
    </UiHostServicesContextProvider>
  );
}
