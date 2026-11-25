import { Dialog } from "@langwatch/design-system/dialog";
import { Text } from "@langwatch/design-system/primitives";
import { useRef } from "react";

import type { MakeDefaultWritePlan } from "../../model/logic/langy-make-default-offer.ts";

/**
 * The "make it the default?" ask that follows a model pick in the composer, for users
 * who can manage the scope the current Langy default lives at (see
 * `langyMakeDefaultOffer`).
 */
export function LangyMakeDefaultDialog({
  plan,
  onDecline,
  onConfirm,
}: {
  /** The write a yes would perform; null when nothing is being asked. */
  plan: MakeDefaultWritePlan | null;
  /**
   * Both handlers close the dialog at once — a yes runs its write in the
   * background and reports a failure as a toast. Holding the dialog open on a
   * spinner made answering a yes/no question feel like submitting a form.
   */
  onDecline: () => void;
  onConfirm: () => void;
}) {
  // The plan outlives the decision by one closing frame, so the dialog keeps
  // its content through its own close animation.
  const lastPlanRef = useRef<MakeDefaultWritePlan | null>(null);
  if (plan) lastPlanRef.current = plan;
  const shown = plan ?? lastPlanRef.current;
  // The model half of the reference, which is how the picker itself words a
  // model (custom aggregator ids keep their inner slashes).
  const modelLabel = shown ? shown.model.split("/").slice(1).join("/") || shown.model : "";

  return (
    // Keeping the pick to this conversation is the safe answer, so it is the
    // one already under the reader's fingers when the dialog opens.
    <Dialog
      open={!!plan}
      onClose={onDecline}
      title="Set model as default?"
      size="md"
      placement="center"
      initialFocus="secondary"
      secondaryAction={{ label: "Just this conversation", onClick: onDecline }}
      primaryAction={shown ? { label: "Make it the default", onClick: onConfirm } : undefined}
      errorScope="Langy default ask"
    >
      {shown ? (
        <Text fontSize="sm" color="fg.muted" wordBreak="break-word">
          Make{" "}
          <Text as="span" fontWeight="semibold" color="fg" data-testid="langy-make-default-model">
            {modelLabel}
          </Text>{" "}
          the default model for Langy for the {shown.scopeLabel}?
        </Text>
      ) : null}
    </Dialog>
  );
}
