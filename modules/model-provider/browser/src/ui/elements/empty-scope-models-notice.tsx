import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { Button, HStack, Text } from "@langwatch/design-system/primitives";
import type { EmptyScopeProvider } from "@langwatch/model-provider-contract";

import {
  emptyProvidersCopy,
  noProviderCopy,
  openProviderLabel,
} from "../../model/empty-scope-models-copy.ts";

/** Above the chat roles when they list nothing at the picked scopes: names why, opens the fix. */
export function ChatModelsNotice({
  emptyProviders,
  onOpenProvider,
}: {
  emptyProviders: readonly EmptyScopeProvider[];
  onOpenProvider: (provider: EmptyScopeProvider) => void;
}) {
  const first = emptyProviders[0];
  return (
    <Banner
      status="warning"
      data-testid="chat-models-empty-notice"
      action={
        first && (
          <BannerAction onClick={() => onOpenProvider(first)}>
            {openProviderLabel({ provider: first })}
          </BannerAction>
        )
      }
    >
      {first
        ? emptyProvidersCopy({ providers: emptyProviders, kind: "chat" })
        : noProviderCopy({ kind: "chat" })}
    </Banner>
  );
}

/** Under the Embeddings row when it lists nothing at the picked scopes. */
export function EmbeddingsModelsHint({
  emptyProviders,
  onOpenProvider,
}: {
  emptyProviders: readonly EmptyScopeProvider[];
  onOpenProvider: (provider: EmptyScopeProvider) => void;
}) {
  const first = emptyProviders[0];
  return (
    <HStack
      align="start"
      gap={2}
      paddingLeft={1}
      paddingBottom={1}
      data-testid="role-row-embeddings-unsupported-hint"
    >
      <Text fontSize="xs" color="fg.muted" flex={1}>
        {first
          ? emptyProvidersCopy({ providers: emptyProviders, kind: "embedding" })
          : noProviderCopy({ kind: "embedding" })}
      </Text>
      {first && (
        <Button variant="plain" size="xs" flexShrink={0} onClick={() => onOpenProvider(first)}>
          {openProviderLabel({ provider: first })}
        </Button>
      )}
    </HStack>
  );
}
