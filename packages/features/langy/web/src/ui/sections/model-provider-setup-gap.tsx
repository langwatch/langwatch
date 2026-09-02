/**
 * The model-provider setup the panel used to embed, and why it is not here.
 *
 * `LangyPanel` rendered `~/features/onboarding/.../ModelProviderScreen` inline,
 * so a reader whose project had no model configured could add one without
 * leaving the dock. That screen belongs to the ONBOARDING family and drags
 * thirty files with it — the credential form, its nine `useModelProvider*`
 * hooks, and six `components/settings` modules that another slice of this
 * migration owns. Taking them would have moved two other families' surfaces
 * inside this one.
 *
 * SO THE INLINE SETUP IS A RECORDED LOSS, in the same class as the Langy
 * context chip the me, automations, agents and datasets families each recorded:
 * the branch still fires, and what it renders now is a way OUT to the settings
 * page rather than the form itself. It closes when the onboarding family moves
 * and `@langwatch/model-provider-web` publishes the screen.
 */

import { Button, Text, VStack } from "@chakra-ui/react";

import { useLangyHost } from "../../model/langy-host";

export type ModelProviderSurface = string;
export type ModelProviderKey = string;

export function ModelProviderScreen({
  onComplete: _onComplete,
  initialProviderKey: _initialProviderKey,
  variant: _variant,
}: {
  variant?: ModelProviderSurface;
  onComplete?: () => void;
  initialProviderKey?: ModelProviderKey;
}) {
  const host = useLangyHost();
  const project = host.project();
  return (
    <VStack gap={3} align="start" padding={4}>
      <Text fontSize="sm" color="fg.muted">
        Langy needs a model provider before it can answer. Add one in the project&apos;s model
        settings, then come back.
      </Text>
      <Button
        size="sm"
        onClick={() => host.navigate(`/${project?.slug ?? ""}/settings/model-providers`)}
      >
        Open model settings
      </Button>
    </VStack>
  );
}
