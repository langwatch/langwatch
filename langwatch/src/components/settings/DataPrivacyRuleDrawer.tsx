import { toaster } from "~/components/ui/toaster";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { PrivacyRuleDrawer } from "~/pages/settings/data-privacy";
import { api } from "~/utils/api";

/**
 * URL-routed shell for the privacy rule drawer (see
 * dev/docs/best_practices/drawers.md). It reconstructs the drawer from the URL
 * alone: the scope params identify which rule to edit, and the policy snapshot
 * is fetched here rather than threaded in, so a pasted link reopens the same
 * rule. Opening with no scope params is the add flow.
 */
export function DataPrivacyRuleDrawer({
  editScopeType,
  editScopeId,
  editPersonalOnly,
}: {
  editScopeType?: string;
  editScopeId?: string;
  editPersonalOnly?: string;
}) {
  const { closeDrawer } = useDrawer();
  const { project, organization } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const utils = api.useUtils();
  const snapshotQuery = api.dataPrivacy.getSnapshot.useQuery(
    { projectId },
    { enabled: !!projectId },
  );
  const setForScope = api.dataPrivacy.setForScope.useMutation();

  const snapshot = snapshotQuery.data;
  if (!snapshot?.available) return null;

  const editingRule =
    editScopeType && editScopeId
      ? (snapshot.rules.find(
          (rule) =>
            rule.scopeType === editScopeType &&
            rule.scopeId === editScopeId &&
            rule.personalOnly === (editPersonalOnly === "true"),
        ) ?? null)
      : null;

  return (
    <PrivacyRuleDrawer
      open={true}
      editingRule={editingRule}
      onClose={closeDrawer}
      available={snapshot.available}
      audienceOptions={snapshot.audienceOptions}
      effectiveTeam={snapshot.effectiveTeam}
      effectiveOrganization={snapshot.effectiveOrganization}
      projectId={projectId}
      currentTeamId={project?.teamId ?? null}
      currentOrganizationId={organization?.id ?? null}
      isSaving={setForScope.isLoading}
      onSave={async (scopes, config) => {
        try {
          await Promise.all(
            scopes.map((scope) =>
              setForScope.mutateAsync({
                projectId,
                scope: { scopeType: scope.scopeType, scopeId: scope.scopeId },
                personalOnly: !!scope.personalOnly,
                config,
              }),
            ),
          );
          void utils.dataPrivacy.getSnapshot.invalidate({ projectId });
          toaster.create({
            title:
              scopes.length > 1
                ? `Privacy rule saved for ${scopes.length} scopes`
                : "Privacy rule saved",
            type: "success",
          });
          closeDrawer();
        } catch (error) {
          toaster.create({
            title: "Failed to save rule",
            description: (error as Error).message,
            type: "error",
          });
        }
      }}
    />
  );
}
