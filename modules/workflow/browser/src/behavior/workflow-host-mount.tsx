/**
 * Workflow's answer to the host its screens, and experiment's, declare: every
 * action projects a `@langwatch/browser-host` capability and is published as the
 * `workflow:host` slice, so the module mounts it, not the application.
 */

import {
  useUiCapabilities,
  useUiCopyTargets,
  useUiScope,
  type UiCopyTargets,
  type UiFeedback,
  type UiNavigation,
  type UiRoute,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import type { UiScopeHost } from "@langwatch/browser-host/use-organization-team-project";
import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";

import type {
  WorkflowCopyPermission,
  WorkflowCopyTarget,
  WorkflowHostSlice,
  WorkflowRouteReading,
  WorkflowScope,
} from "../model/workflow-host.ts";
import { workflowHostSlice } from "./workflow-host.store.ts";

function capabilityWorkflowHost({
  scopeHost,
  session,
  lent,
  uiRoute,
  navigation,
  feedback,
}: {
  scopeHost: UiScopeHost | undefined;
  session: UiSession;
  lent: UiCopyTargets;
  uiRoute: UiRoute;
  navigation: UiNavigation;
  feedback: UiFeedback;
}): WorkflowHostSlice {
  return {
    scope(): WorkflowScope {
      const project = scopeHost?.project();
      return {
        projectId: project?.id,
        projectSlug: project?.slug,
        projectName: project?.name,
        organizationId: scopeHost?.organization()?.id,
        teamId: scopeHost?.team()?.id,
        isResolved: scopeHost ? !scopeHost.isLoading() : false,
      };
    },

    hasPermission: (permission) => session.hasPermission(permission),

    /** Organization's lent targets; no answer yet is no target (§10.1, array port). */
    copyTargets({
      permission,
    }: {
      permission: WorkflowCopyPermission;
    }): readonly WorkflowCopyTarget[] {
      return (lent.targets(permission) ?? []).map((target) => ({
        id: target.projectId,
        name: target.label,
        canCreate: target.mayCreate,
      }));
    },

    route(): WorkflowRouteReading {
      const { params, query, pathname } = uiRoute.reading();
      return pathname === void 0 ? { params, query } : { params, query, pathname };
    },

    /** MERGES into the query, unlike the capability's own REPLACE semantics. */
    setQuery: (next, options) => uiRoute.setQuery({ ...uiRoute.reading().query, ...next }, options),

    navigate: (to) => navigation.navigate(to),
    back: () => navigation.back(),
    succeeded: (notice) => feedback.succeeded(notice),
    failed: (failure) => feedback.failed(failure),
  };
}

/**
 * The mount the declaration names: publishes the host into `workflow:host`
 * above the routed tree, and renders the tree once it is there. Default-exported
 * because that is what `mounts.load` resolves.
 */
export default function WorkflowHostMount({ children }: { children?: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const lent = useUiCopyTargets();
  const scopeHost = useUiScope().scopeHost();
  const [published, setPublished] = useState(false);

  const host = useMemo(
    () =>
      capabilityWorkflowHost({
        scopeHost,
        session,
        lent,
        uiRoute: route,
        navigation,
        feedback,
      }),
    [scopeHost, session, lent, route, navigation, feedback],
  );

  useLayoutEffect(() => {
    workflowHostSlice.setState(host, true);
    setPublished(true);
  }, [host]);

  return published ? <>{children}</> : null;
}
