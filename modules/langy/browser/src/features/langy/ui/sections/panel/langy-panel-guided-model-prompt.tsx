/**
 * Langy's ask for a model after a guided tour whose provider step was skipped: one message in the
 * conversation, below the tour card, carrying the panel's own provider setup and a "Later".
 * @see specs/langy/langy-inline-model-setup.feature
 */
import { Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";

import { LangyModelProviderSetup } from "../../../../../ui/sections/model-provider-setup.tsx";
import { useGuidedTour } from "../../../behavior/use-guided-tour.ts";

export const GUIDED_MODEL_PROMPT_LINE =
  "Now connect me to a model provider so I can integrate your app and start creating evals for you.";

export function LangyGuidedModelPrompt({
  organizationId,
  onComplete,
  onLater,
}: {
  /** The organization "Later" is recorded on; absent records nothing. */
  organizationId: string | null;
  onComplete: () => void;
  onLater: () => void;
}) {
  const putOff = useGuidedTour().usePutOffModelPrompt();
  return (
    <VStack data-testid="langy-guided-model-prompt" align="stretch" gap={3}>
      <Text textStyle="sm" lineHeight="1.5" color="fg">
        {GUIDED_MODEL_PROMPT_LINE}
      </Text>
      <HStack>
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            if (organizationId) putOff({ organizationId });
            onLater();
          }}
        >
          Later
        </Button>
      </HStack>
      <LangyModelProviderSetup onComplete={onComplete} />
    </VStack>
  );
}
