/**
 * The model-provider setup the panel used to embed, and why it is not here.
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
