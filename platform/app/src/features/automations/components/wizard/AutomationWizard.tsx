import { VStack } from "@chakra-ui/react";
import { useWizardStep } from "../../state/selectors";
import { NameField } from "../NameField";
import { DeliveryStep } from "./DeliveryStep";
import { ReviewStep } from "./ReviewStep";
import { StepRail } from "./StepRail";
import { WatchStep } from "./WatchStep";

/**
 * The merged authoring wizard (ADR-093 §4): Watch → Delivery → Review, linear
 * to create and hub-and-spoke to edit.
 *
 * This holds the shape only — the name (editable throughout, which is why it
 * sits above the rail rather than inside a step), the rail, and whichever step
 * is on screen. The footer's Back / Continue / Done / Save actions belong to
 * the drawer, which owns saving and test firing.
 *
 * Schedules are not authored here: the clock is not something to watch, and
 * unifying their shell is explicitly deferred.
 */
export function AutomationWizard({
  projectId,
  isEdit,
  prefilledGraphId,
  subjectLocked,
  webhookEnabled,
  graphName,
  seriesLabel,
  onCreateNew,
}: {
  projectId: string;
  isEdit: boolean;
  prefilledGraphId?: string;
  /** What a saved automation watches cannot change (ADR-093 §1). */
  subjectLocked: boolean;
  webhookEnabled: boolean;
  graphName?: string | null;
  seriesLabel?: string | null;
  onCreateNew?: () => void;
}) {
  const step = useWizardStep();

  return (
    <VStack align="stretch" gap={4}>
      <NameField isEdit={isEdit} />
      <StepRail graphName={graphName} />
      {step === "watch" ? (
        <WatchStep
          prefilledGraphId={prefilledGraphId}
          subjectLocked={subjectLocked}
          onCreateNew={onCreateNew}
        />
      ) : step === "delivery" ? (
        <DeliveryStep isEdit={isEdit} webhookEnabled={webhookEnabled} />
      ) : (
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
