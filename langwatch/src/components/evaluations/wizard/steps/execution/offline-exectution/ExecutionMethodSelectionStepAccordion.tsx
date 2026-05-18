import { RadioCard } from "@chakra-ui/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { useCallback } from "react";
import {
  LuCode,
  LuGlobe,
  LuMessageSquareCode,
  LuTerminal,
  LuWorkflow,
} from "react-icons/lu";
import { useShallow } from "zustand/react/shallow";
import { useAnimatedFocusElementById } from "../../../../../../hooks/useAnimatedFocusElementById";
import { useOrganizationTeamProject } from "../../../../../../hooks/useOrganizationTeamProject";
import { api } from "../../../../../../utils/api";
import { ExecutionStepAccordion } from "../../../components/ExecutionStepAccordion";
import { StepRadio } from "../../../components/StepButton";
import {
  EXECUTION_METHODS,
  type OfflineExecutionMethod,
  useEvaluationWizardStore,
} from "../../../hooks/evaluation-wizard-store/useEvaluationWizardStore";

export const EXECUTION_METHOD_SELECTOR_STEP_ACCORDION_VALUE =
  "execution-method-selector";

export function ExecutionMethodSelectionStepAccordion({
  onSelect,
}: {
  onSelect: (executionMethod: OfflineExecutionMethod) => void;
}) {
  const { project } = useOrganizationTeamProject();
  // Cascade-resolved DEFAULT model — fed to the executor node factory
  // via the slice's `defaultModel` param. Empty string is a valid
  // hand-off (the LLM-node UI surfaces the missing default at first
  // run via the MissingModelToast).
  const resolvedDefault = api.modelProvider.getResolvedDefault.useQuery(
    { projectId: project?.id ?? "", featureKey: "prompt.create_default" },
    { enabled: !!project?.id },
  );
  const updateNodeInternals = useUpdateNodeInternals();
  const { executionMethod, upsertExecutorNodeByType, setWizardState } =
    useEvaluationWizardStore(
      useShallow(
        ({ workbenchState, setWizardState, upsertExecutorNodeByType }) => ({
          executionMethod: workbenchState.executionMethod,
          setWizardState,
          upsertExecutorNodeByType,
        }),
      ),
    );

  const focusElementById = useAnimatedFocusElementById();

  const handleOptionClick = useCallback(
    (value: OfflineExecutionMethod) => {
      setWizardState({
        executionMethod: value,
      });
      focusElementById("js-next-step-button");
      onSelect(value);
    },
    [setWizardState, focusElementById, onSelect],
  );

  const buildBaseRadioParams = useCallback(
    (value: OfflineExecutionMethod) => {
      return {
        value,
        title: EXECUTION_METHODS[value],
        onClick: () => handleOptionClick(value),
      };
    },
    [handleOptionClick],
  );

  return (
    <ExecutionStepAccordion
      value={EXECUTION_METHOD_SELECTOR_STEP_ACCORDION_VALUE}
      title="Execution Method"
      showTrigger={true}
    >
      <RadioCard.Root
        variant="outline"
        colorPalette="orange"
        value={executionMethod}
        paddingBottom={1}
      >
        <StepRadio
          {...buildBaseRadioParams("offline_prompt")}
          description="Run a prompt via any LLM model to evaluate"
          icon={<LuMessageSquareCode />}
          onClick={() => {
            const nodeId = upsertExecutorNodeByType({
              type: "signature",
              defaultModel: resolvedDefault.data?.model ?? "",
            });
            updateNodeInternals(nodeId);
            handleOptionClick("offline_prompt");
          }}
        />
        <StepRadio
          {...buildBaseRadioParams("offline_code_execution")}
          description="Run code"
          icon={<LuCode />}
          onClick={() => {
            const nodeId = upsertExecutorNodeByType({
              type: "code",
              defaultModel: resolvedDefault.data?.model ?? "",
            });
            updateNodeInternals(nodeId);
            handleOptionClick("offline_code_execution");
          }}
        />
        <StepRadio
          {...buildBaseRadioParams("offline_http")}
          description="Execute your LLM pipeline if it's available on an HTTP endpoint"
          icon={<LuGlobe />}
          disabled
        />
        <StepRadio
          {...buildBaseRadioParams("offline_workflow")}
          description="Create a Workflow for building a more complex pipeline to be evaluated"
          icon={<LuWorkflow />}
          disabled
        />
        <StepRadio
          {...buildBaseRadioParams("offline_notebook")}
          description="Use LangWatch Python SDK to run"
          icon={<LuTerminal />}
          disabled
        />
      </RadioCard.Root>
    </ExecutionStepAccordion>
  );
}
