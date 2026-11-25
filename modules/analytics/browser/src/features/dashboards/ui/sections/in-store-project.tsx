/**
 * An org-level page that reads a project's data (`/dashboards/templates`, a From LangWatch board),
 * opened only while the organization's flags open the area. It runs in the store project, the
 * one in view when that is a candidate; with no store project it only reads, in the one in view.
 */

import { UiPageLoading, UiPageNotFound } from "@langwatch/browser/page-fallbacks";
import type { ReactNode } from "react";

import { InProject } from "../../../../behavior/in-project.tsx";
import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useOrganizationLibraryOpen } from "../../behavior/use-organization-library-open.ts";
import { useStoreProject } from "../../behavior/use-store-project.ts";

export function InStoreProject({ children }: { children: ReactNode }) {
  const projectInView = useAnalyticsHost().project();
  const library = useOrganizationLibraryOpen();
  const store = useStoreProject({ enabled: library.isOpen });
  if (library.isLoading || store.isLoading) return <UiPageLoading />;
  if (!library.isOpen) return <UiPageNotFound />;
  const project = store.storeProject ?? projectInView;
  if (!project) return <UiPageNotFound />;
  if (project.id === projectInView?.id) return <>{children}</>;
  return <InProject project={project}>{children}</InProject>;
}
