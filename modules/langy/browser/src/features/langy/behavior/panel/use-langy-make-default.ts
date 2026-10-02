import { showErrorToast } from "@langwatch/browser-host/errors";
import { toaster } from "@langwatch/design-system/toaster";
import { useRef, useState } from "react";

import { api } from "../../../../behavior/langy-api.ts";
import { useLangyStore } from "../../../../behavior/langy.store.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import {
  type MakeDefaultWritePlan,
  makeDefaultOffer,
} from "../../model/logic/langy-make-default-offer.ts";
import { syncLangyAfterDefaultModelWrite } from "../logic/coding-default-sync.ts";
import { LANGY_GATE_FEATURE_KEY } from "./use-langy-composer-model.ts";

type ResolvedDefault = Parameters<typeof makeDefaultOffer>[0]["resolvedDefault"];

/**
 * "Make it the default?" — the ask that follows a model pick. The pick took effect for this
 * conversation already; the dialog only offers to write it as the default at the scope the
 * current default lives at, and only to someone who can manage that scope.
 */
export function useLangyMakeDefault({ resolvedDefault }: { resolvedDefault: ResolvedDefault }) {
  const { organization, team, project, hasOrgPermission, hasPermission } =
    useOrganizationTeamProject();
  const projectId = project?.id;
  const utils = api.useUtils();
  const requestComposerFocus = useLangyStore((s) => s.requestComposerFocus);
  const setRoleAssignment = api.modelProvider.setRoleAssignmentForScope.useMutation();
  const setFeatureOverride = api.modelProvider.setFeatureOverrideForScope.useMutation();
  const [plan, setPlan] = useState<MakeDefaultWritePlan | null>(null);
  // Declines are per model per panel session: refusing once must not nag on
  // the next pick of the same model, and must not mute the ask forever.
  const declinedRef = useRef<Set<string>>(new Set());

  const offer = (picked: string) => {
    if (declinedRef.current.has(picked)) return;
    const next = makeDefaultOffer({
      picked,
      resolvedDefault,
      canManage: {
        organization: hasOrgPermission("organization:manage"),
        team: hasPermission("team:manage"),
        project: hasPermission("project:update"),
      },
      scopeIds: {
        organizationId: organization?.id ?? null,
        teamId: team?.id ?? null,
        projectId: projectId ?? null,
      },
    });
    if (next) setPlan(next);
  };

  // The dialog closes the moment the question is answered and the write runs
  // behind it; only a genuine write failure has anything to say, as a toast.
  const confirm = () => {
    if (!plan || !projectId) return;
    setPlan(null);
    requestComposerFocus();
    const write =
      plan.kind === "feature-override"
        ? setFeatureOverride.mutateAsync({
            scopeType: plan.scopeType,
            scopeId: plan.scopeId,
            featureKey: LANGY_GATE_FEATURE_KEY,
            model: plan.model,
          })
        : setRoleAssignment.mutateAsync({
            scopeType: plan.scopeType,
            scopeId: plan.scopeId,
            role: "LANGY",
            model: plan.model,
          });
    void write
      .then(() => syncLangyAfterDefaultModelWrite({ utils, projectId, fallbackModel: plan.model }))
      .then(() =>
        toaster.create({ title: "Langy default updated", type: "success", duration: 2500 }),
      )
      .catch((error: unknown) =>
        showErrorToast({ error, fallbackTitle: "Couldn't update the Langy default" }),
      );
  };

  const decline = () => {
    if (plan) declinedRef.current.add(plan.model);
    setPlan(null);
    requestComposerFocus();
  };

  return { plan, offer, confirm, decline };
}
