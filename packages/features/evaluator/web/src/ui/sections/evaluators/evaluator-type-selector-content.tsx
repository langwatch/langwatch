import { type EvaluatorCategoryId } from "../../blocks/evaluator-category-picker.tsx";
import { EvaluatorTypePicker } from "../../blocks/evaluator-type-picker.tsx";
import { useDrawer } from "@langwatch/ui-drawer";
import { useOrganizationTeamProject } from "@langwatch/ui-host/use-organization-team-project";
import { api } from "@langwatch/workflow-web/surfaces/workflow-api";
import { useRouter } from "@langwatch/ui-host/use-router";

export { evaluatorCategoryNames as categoryNames } from "../../../index.ts";

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
