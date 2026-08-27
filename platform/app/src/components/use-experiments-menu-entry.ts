import { useMemo, useState } from "react";
import type { ExperimentTenantScope, FrontendFeatureFlag } from "@langwatch/feature-flag-contract";
import { useExperimentCatalogueWatermark } from "@langwatch/feature-flag-web";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { api } from "../utils/api";

/**
 * Transport and state for the Experiments entry in the settings menu.
 *
 * The app owns the query, the mutations and the permission read; the dialog
 * that renders the result is a controlled component in
 * `@langwatch/feature-flag-web` and knows about none of them.
 */
export function useExperimentsMenuEntry({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const { project, organization, hasPermission, hasOrgPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  const target = useMemo(() => {
    if (project?.id && organization?.id) {
      return {
        kind: "project" as const,
        projectId: project.id,
        organizationId: organization.id,
      };
    }
    if (organization?.id) {
      return { kind: "organization" as const, organizationId: organization.id };
    }

    return { kind: "user" as const };
  }, [project?.id, organization?.id]);

  const utils = api.useUtils();
  const catalogue = api.featureFlag.experiments.useQuery(
    { target },
    { enabled, refetchOnWindowFocus: false },
  );
  const experiments = catalogue.data?.experiments ?? [];

  const { hasUnseen, markSeen } = useExperimentCatalogueWatermark(
    experiments.map((entry) => entry.catalogueVersion),
  );

  const invalidate = async () => {
    await utils.featureFlag.experiments.invalidate();
    await utils.featureFlag.resolve.invalidate();
  };
  const setEnrolment = api.featureFlag.setExperimentEnrolment.useMutation({
    onSuccess: invalidate,
  });
  const setTenantPolicy = api.featureFlag.setExperimentTenantPolicy.useMutation({
    onSuccess: invalidate,
  });

  // Only offer a scope the viewer may actually govern; the server authorizes
  // the same scope again on write.
  const manageableScopes: ExperimentTenantScope[] = [];
  if (enabled && project?.id && hasPermission("featureFlags:manageExperiments")) {
    manageableScopes.push({ kind: "project", projectId: project.id });
  }
  if (enabled && organization?.id && hasOrgPermission("featureFlags:manageExperiments")) {
    manageableScopes.push({ kind: "organization", organizationId: organization.id });
  }

  return {
    // The entry hides entirely when nothing is open to this viewer, so an
    // empty dialog is never reachable.
    isAvailable: enabled && experiments.length > 0,
    hasUnseen,
    open,
    onOpen: () => {
      setOpen(true);
      markSeen();
    },
    onOpenChange: setOpen,
    experiments,
    isLoading: catalogue.isLoading,
    manageableScopes,
    onSetEnrolment: ({ flag, enrolled }: { flag: FrontendFeatureFlag; enrolled: boolean }) => {
      if (!enabled) return;

      setEnrolment.mutate({ flag, target, enrolled });
    },
    onSetTenantPolicy: ({
      flag,
      scope,
      policy,
    }: {
      flag: FrontendFeatureFlag;
      scope: ExperimentTenantScope;
      policy: "inherit" | "enabled" | "disabled";
    }) => {
      if (!enabled) return;

      setTenantPolicy.mutate({ flag, scope, policy });
    },
  };
}
