import { VStack } from "@langwatch/design-system/primitives";

import { stepIsComplete, stepSummary } from "../../model/wizard-steps.ts";
import { StepRail } from "../blocks/step-rail.tsx";
import { AutomationNameField } from "../elements/name-field.tsx";
import {
  useConfigComplete,
  useDraft,
  useFurthestWizardStep,
  useWizardStep,
} from "./automation-selectors.ts";
import { useAutomationStore } from "./automation-store.ts";
import { CLIENT_PROVIDERS } from "./client-providers.ts";
import { DeliveryStep } from "./delivery-step.tsx";
import { ReviewStep } from "./review-step.tsx";
import { WatchStep } from "./watch-step.tsx";

/**
 * The authoring wizard (ADR-093 §4): Watch, Delivery, Review; linear to create,
 * hub-and-spoke to edit. The name sits above the rail. The footer's buttons belong
 * to the drawer, which owns saving and test firing. Reports are not authored here.
 */
export function AutomationWizard({
  projectId,
  isEdit,
  prefilledGraphId,
  subjectLocked,
  graphName,
  seriesLabel,
  onCreateNew,
}: {
  projectId: string;
  isEdit: boolean;
  prefilledGraphId?: string;
  /** What a saved automation watches cannot change (ADR-093 §1). */
  subjectLocked: boolean;
  graphName?: string | null;
  seriesLabel?: string | null;
  onCreateNew?: () => void;
}) {
  const draft = useDraft();
  const step = useWizardStep();
  const furthestStep = useFurthestWizardStep();
  const configComplete = useConfigComplete();
  const dispatch = useAutomationStore((s) => s.dispatch);
  const setStep = useAutomationStore((s) => s.setStep);

  return (
    <VStack align="stretch" gap={4}>
      <AutomationNameField
        source={draft.source}
        value={draft.name}
        isEdit={isEdit}
        configComplete={configComplete}
        noun="automation"
        onChange={(value) => dispatch({ type: "SET_NAME", value })}
      />
      <StepRail
        step={step}
        furthestStep={furthestStep}
        isComplete={(candidate) =>
          stepIsComplete({ step: candidate, draft, registry: CLIENT_PROVIDERS })
        }
        summaryOf={(candidate) =>
          stepSummary({ step: candidate, draft, registry: CLIENT_PROVIDERS, graphName })
        }
        onSelect={setStep}
      />
      {step === "watch" && (
        <WatchStep
          prefilledGraphId={prefilledGraphId}
          subjectLocked={subjectLocked}
          onCreateNew={onCreateNew}
        />
      )}
      {step === "delivery" && <DeliveryStep isEdit={isEdit} />}
      {step === "review" && (
        <ReviewStep
          projectId={projectId}
          isEdit={isEdit}
          graphName={graphName}
          seriesLabel={seriesLabel}
        />
      )}
    </VStack>
  );
}
