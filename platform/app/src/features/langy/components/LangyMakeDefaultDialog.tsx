import { Button, HStack, Spacer, Text } from "@chakra-ui/react";
import { useRef } from "react";

import { Dialog } from "~/components/ui/dialog";
import type { MakeDefaultWritePlan } from "../logic/langyMakeDefaultOffer";

/**
 * The "make it the default?" ask that follows a model pick in the composer,
 * for users who can manage the scope the current Langy default lives at (see
 * `langyMakeDefaultOffer`). The pick already took effect for this
 * conversation either way — the dialog only decides whether it becomes the
 * default for everyone under that scope.
 */
export function LangyMakeDefaultDialog({
  plan,
  isBusy,
  onDecline,
  onConfirm,
}: {
  /** The write a yes would perform; null when nothing is being asked. */
  plan: MakeDefaultWritePlan | null;
  isBusy: boolean;
  onDecline: () => void;
  onConfirm: () => void;
}) {
  // Keeping the pick to this conversation is the safe answer, so it is the
  // one already under the reader's fingers when the dialog opens.
  const declineRef = useRef<HTMLButtonElement>(null);
  // The plan outlives the decision by one closing frame, so the dialog keeps
  // its content through its own close animation.
  const lastPlanRef = useRef<MakeDefaultWritePlan | null>(null);
  if (plan) lastPlanRef.current = plan;
  const shown = plan ?? lastPlanRef.current;
  // The model half of the reference, which is how the picker itself words a
  // model (custom aggregator ids keep their inner slashes).
  const modelLabel = shown
    ? shown.model.split("/").slice(1).join("/") || shown.model
    : "";

  return (
    <Dialog.Root
      open={!!plan}
      placement="center"
      onOpenChange={(details) => {
        if (!details.open) onDecline();
      }}
      initialFocusEl={() => declineRef.current}
    >
      {shown ? (
        <Dialog.Content bg="bg" maxWidth="480px" errorScope="Langy default ask">
          <Dialog.Header>
            <Dialog.Title fontSize="md" fontWeight="500">
              Set default model?
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.Body paddingTop={0}>
            <Text fontSize="sm" color="fg.muted" wordBreak="break-word">
              Make{" "}
              <Text
                as="span"
                fontWeight="semibold"
                color="fg"
                data-testid="langy-make-default-model"
              >
                {modelLabel}
              </Text>{" "}
              the default model for Langy for the {shown.scopeLabel}?
            </Text>
          </Dialog.Body>
          <Dialog.Footer>
            <HStack width="full">
              <Spacer />
              <Button
                ref={declineRef}
                variant="ghost"
                onClick={onDecline}
                disabled={isBusy}
              >
                Just this conversation
              </Button>
              <Button
                colorPalette="orange"
                onClick={onConfirm}
                loading={isBusy}
              >
                Make it the default
              </Button>
            </HStack>
          </Dialog.Footer>
        </Dialog.Content>
      ) : null}
    </Dialog.Root>
  );
}
