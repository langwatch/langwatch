import { EvaluatorTypePicker, type EvaluatorCategoryId } from "@langwatch/evaluator-web";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

export { evaluatorCategoryNames as categoryNames } from "@langwatch/evaluator-web";

export type EvaluatorTypeSelectorContentProps = {
  category?: EvaluatorCategoryId;
  onSelect?: (evaluatorType: string) => void;
  onClose?: () => void;
};

/** App adapter for availability transport and routing around the portable picker. */
export function EvaluatorTypeSelectorContent({
  category,
  onSelect,
  onClose,
}: EvaluatorTypeSelectorContentProps) {
  const { openDrawer } = useDrawer();
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const availableEvaluatorsQuery = api.evaluations.availableEvaluators.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  return (
    <EvaluatorTypePicker
      category={category}
      availability={availableEvaluatorsQuery.data}
      onSelect={(evaluatorType) => {
        if (onSelect) {
          onSelect(evaluatorType);
          return;
        }
        openDrawer("evaluatorEditor", { evaluatorType, category });
      }}
      onConfigureAzureSafety={() => {
        onClose?.();
        void router.push({
          pathname: "/settings/model-providers",
          query: {
            "drawer.open": "editModelProvider",
            "drawer.providerKey": "azure_safety",
          },
        });
      }}
    />
  );
}
