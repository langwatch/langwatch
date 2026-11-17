import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { Button, HStack, Text } from "@langwatch/design-system/primitives";
import type { EmptyScopeProvider, ScopeModelOptions } from "@langwatch/model-provider-contract";

import type { ScopeModelOptionsRead } from "../../behavior/use-scope-model-options.ts";
import {
  emptyProvidersCopy,
  noProviderCopy,
  openProviderLabel,
  SCOPE_MODELS_FAILED_COPY,
  SCOPE_MODELS_REFUSED_COPY,
  sharesNoneCopy,
} from "../../model/empty-scope-models-copy.ts";

type Kind = "chat" | "embedding";

/** Opens a named provider's editor; `find` picks the first one that editor can open. */
export type ProviderOpener = {
  find: (providers: readonly EmptyScopeProvider[]) => EmptyScopeProvider | undefined;
  open: (provider: EmptyScopeProvider) => void;
};

/** Why a picker of this kind lists nothing: no shared model, an empty provider, or no provider. */
function whyEmptyCopy({
  kind,
  sharesNone,
  emptyProviders,
}: {
  kind: Kind;
  sharesNone: boolean;
  emptyProviders: readonly EmptyScopeProvider[];
}): string {
  if (sharesNone) return sharesNoneCopy({ kind });
  if (emptyProviders.length > 0) return emptyProvidersCopy({ providers: emptyProviders, kind });
  return noProviderCopy({ kind });
}

/** Above the roles: why the scopes' models could not be read, or why they list no chat model. */
export function ScopeModelsNotice({
  read,
  options,
  openable,
  onRetry,
}: {
  read: ScopeModelOptionsRead;
  options: ScopeModelOptions;
  openable: ProviderOpener;
  onRetry: () => void;
}) {
  if (read === "refused" || read === "failed") {
    return <ScopeModelsReadNotice read={read} onRetry={onRetry} />;
  }
  if (read !== "answered" || options.chat.length > 0) return null;
  return (
    <ChatModelsNotice
      emptyProviders={options.emptyProviders.chat}
      sharesNone={options.sharesNone.chat}
      openable={openable}
    />
  );
}

/** A refusal says a picked scope is out of reach; any other failure offers to try again. */
function ScopeModelsReadNotice({
  read,
  onRetry,
}: {
  read: "refused" | "failed";
  onRetry: () => void;
}) {
  return (
    <Banner
      status={read === "refused" ? "warning" : "error"}
      data-testid="scope-models-read-notice"
      action={read === "failed" && <BannerAction onClick={onRetry}>Try again</BannerAction>}
    >
      {read === "refused" ? SCOPE_MODELS_REFUSED_COPY : SCOPE_MODELS_FAILED_COPY}
    </Banner>
  );
}

/**
 * Above the chat roles when they list nothing at the picked scopes: names why, and opens the
 * empty provider when the provider editor can open it.
 */
function ChatModelsNotice({
  emptyProviders,
  sharesNone,
  openable,
}: {
  emptyProviders: readonly EmptyScopeProvider[];
  sharesNone: boolean;
  openable: ProviderOpener;
}) {
  const first = sharesNone ? undefined : openable.find(emptyProviders);
  return (
    <Banner
      status="warning"
      data-testid="chat-models-empty-notice"
      action={
        first && (
          <BannerAction onClick={() => openable.open(first)}>
            {openProviderLabel({ provider: first })}
          </BannerAction>
        )
      }
    >
      {whyEmptyCopy({ kind: "chat", sharesNone, emptyProviders })}
    </Banner>
  );
}

/** Under the Embeddings row when it lists nothing at the picked scopes. */
export function EmbeddingsModelsHint({
  emptyProviders,
  sharesNone,
  openable,
}: {
  emptyProviders: readonly EmptyScopeProvider[];
  sharesNone: boolean;
  openable: ProviderOpener;
}) {
  const first = sharesNone ? undefined : openable.find(emptyProviders);
  return (
    <HStack
      align="start"
      gap={2}
      paddingLeft={1}
      paddingBottom={1}
      data-testid="role-row-embeddings-unsupported-hint"
    >
      <Text fontSize="xs" color="fg.muted" flex={1}>
        {whyEmptyCopy({ kind: "embedding", sharesNone, emptyProviders })}
      </Text>
      {first && (
        <Button variant="plain" size="xs" flexShrink={0} onClick={() => openable.open(first)}>
          {openProviderLabel({ provider: first })}
        </Button>
      )}
    </HStack>
  );
}
