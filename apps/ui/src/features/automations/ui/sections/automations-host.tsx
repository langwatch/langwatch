/**
 * What the automations screen and its two editors are mounted inside: the
 * tRPC Provider their hooks run on, and the host port for scope, permissions,
 * flags, address and feedback. Reads the team too, since Slack delivery stamps a message with it.
 */

import {
  automationApi,
  AutomationHostProvider,
  type AutomationFailureNotice,
  type AutomationHostPort,
} from "@langwatch/automation-web/screens/automations";
import { useMemo, type ReactNode } from "react";
import { readPublicAppConfig } from "../../../../behavior/public-config";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { resolveUiFailureCopy } from "../../../../behavior/ui-feedback";
import { resolveAutomationsDrawerAddress } from "../../behavior/automations-drawer-address";
import { DRAWER_OPEN_PARAM } from "../../../drawers";

/**
 * This application's own address, for the links a rendered preview prints.
 * No configured base URL means a self-hosted deployment with none stated,
 * not a broken one, so this falls back to the hosted application's address.
 */
function readAppBaseUrl(): string {
  try {
    return readPublicAppConfig().appBaseUrl;
  } catch {
    return "https://app.langwatch.ai";
  }
}

export function AutomationsHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();

  const organizations = automationApi.organization.getAll.useQuery({ isDemo: false });

  /** The organization, team and project the address is about, resolved from the one graph read rather than three. */
  const placement = useMemo(() => {
    const organization = (organizations.data ?? []).find(
      (candidate) => candidate.id === scope.organizationId,
    );
    const team = organization?.teams.find((candidate) =>
      candidate.projects.some((project) => project.id === scope.projectId),
    );
    const project = team?.projects.find((candidate) => candidate.id === scope.projectId);
    return {
      organization: organization
        ? { id: organization.id, name: organization.name, slug: organization.slug }
        : void 0,
      team: team ? { id: team.id, name: team.name, slug: team.slug } : void 0,
      project: project ? { id: project.id, name: project.name, slug: project.slug } : void 0,
    };
  }, [organizations.data, scope.organizationId, scope.projectId]);

  const reading = route.reading();
  const host = useMemo<AutomationHostPort>(
    () => ({
      scope: () => ({
        organizationId: scope.organizationId,
        teamId: placement.team?.id ?? null,
        projectId: scope.projectId,
      }),
      organization: () => placement.organization,
      team: () => placement.team,
      project: () => placement.project,
      hasPermission: (permission) => session.hasPermission(permission),
      // Fails closed: an answer that has not arrived reads as no.
      isFeatureEnabled: (flag) => session.featureFlag(flag) === true,
      featureFlag: (flag) => session.featureFlag(flag),
      appBaseUrl: () => readAppBaseUrl(),
      route: () => reading,
      setQuery: (next, options) => route.setQuery(next, options),
      navigate: (to) => navigation.navigate(to),
      openDrawer: ({ drawer, params = {} }) =>
        route.setQuery(
          resolveAutomationsDrawerAddress({
            query: reading.query,
            drawer,
            params,
            openParam: DRAWER_OPEN_PARAM,
          }),
        ),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
      // The one line a surface too tight for a toast prints. Same copy the
      // toast would have shown, so a failure never reads two different ways
      // depending on where it surfaced.
      describeFailure: (failure: AutomationFailureNotice) =>
        failure.title ??
        resolveUiFailureCopy({
          error: failure.error,
          fallbackTitle: failure.fallbackTitle,
        }).title,
    }),
    [
      scope.organizationId,
      scope.projectId,
      placement,
      reading,
      session,
      route,
      navigation,
      feedback,
    ],
  );

  return <AutomationHostProvider value={host}>{children}</AutomationHostProvider>;
}
