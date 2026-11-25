/**
 * Runs what it wraps in another project than the page's: the sidebar section in the project
 * navigation named, an org-level board in the project it opens in.
 */

import {
  UiHostServicesContextProvider,
  useOptionalUiHostServices,
} from "@langwatch/browser-host/capabilities";
import { type ReactNode, useMemo } from "react";

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
  const scoped = useMemo(
    () => analyticsHostInProject({ host, project: { id, slug, name } }),
    [host, id, slug, name],
  );
  const scopedServices = useMemo(
    () =>
      services?.analytics
        ? {
            ...services,
            analytics: uiAnalyticsInProject({
              analytics: services.analytics,
              projectId: id,
              pageProjectId,
            }),
          }
        : void 0,
    [services, id, pageProjectId],
  );
  const section = <AnalyticsHostProvider value={scoped}>{children}</AnalyticsHostProvider>;
  if (!scopedServices) return section;
  return (
    <UiHostServicesContextProvider value={scopedServices}>{section}</UiHostServicesContextProvider>
  );
}
