import { Card } from "@langwatch/design-system/card";
import { Dialog } from "@langwatch/design-system/dialog";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Box, HStack, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { SmallLabel } from "@langwatch/design-system/small-label";
import { getProviderModelOptions, type CustomModelEntry } from "@langwatch/model-provider-contract";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

type RegistryModelsModalProps = {
  open: boolean;
  onClose: () => void;
  provider: string;
  /** The provider's own models in place of the catalogue: a custom provider serves only these. */
  providerModels?: CustomModelEntry[];
  /** `card` keeps the card ground the onboarding page gives its dialogs. */
  ground?: "card";
};

type ModelOption = { value: string; label: string };

function optionsFor(entries: CustomModelEntry[], mode: CustomModelEntry["mode"]): ModelOption[] {
  return entries
    .filter((entry) => entry.mode === mode)
    .map((entry) => ({ value: entry.modelId, label: entry.displayName }));
}

/**
 * Read-only modal that lists a provider's registry models, or its own models when
 * `providerModels` is given, grouped into Chat and Embedding with a search filter.
 */
export function RegistryModelsModal({
  open,
  onClose,
  provider,
  providerModels,
  ground,
}: RegistryModelsModalProps) {
  const [search, setSearch] = useState("");

  const chatModels = useMemo(
    () =>
      providerModels
        ? optionsFor(providerModels, "chat")
        : getProviderModelOptions(provider, "chat"),
    [provider, providerModels],
  );

  const embeddingModels = useMemo(
    () =>
      providerModels
        ? optionsFor(providerModels, "embedding")
        : getProviderModelOptions(provider, "embedding"),
    [provider, providerModels],
  );

  const filteredChatModels = useMemo(() => {
    if (!search.trim()) return chatModels;
    const term = search.toLowerCase();
    return chatModels.filter(
      (m) => m.value.toLowerCase().includes(term) || m.label.toLowerCase().includes(term),
    );
  }, [chatModels, search]);

  const filteredEmbeddingModels = useMemo(() => {
    if (!search.trim()) return embeddingModels;
    const term = search.toLowerCase();
    return embeddingModels.filter(
      (m) => m.value.toLowerCase().includes(term) || m.label.toLowerCase().includes(term),
    );
  }, [embeddingModels, search]);

  const handleClose = () => {
    setSearch("");
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={providerModels ? "Provider models" : "Registry models"}
      size="lg"
      ground={ground}
      cancelLabel="Close"
    >
      <VStack gap={4} align="stretch">
        <HStack>
          <Search size={16} />
          <Input
            placeholder="Search models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search models"
          />
        </HStack>

        {filteredChatModels.length > 0 && (
          <VStack gap={2} align="stretch">
            <SmallLabel>Chat Models</SmallLabel>
            <Card variant="frame" padding="sm">
              <Box maxHeight="200px" overflowY="auto">
                {filteredChatModels.map((model) => (
                  <Text key={model.value} fontSize="sm" paddingY={1}>
                    {model.label}
                  </Text>
                ))}
              </Box>
            </Card>
          </VStack>
        )}

        {filteredEmbeddingModels.length > 0 && (
          <VStack gap={2} align="stretch">
            <SmallLabel>Embedding Models</SmallLabel>
            <Card variant="frame" padding="sm">
              <Box maxHeight="200px" overflowY="auto">
                {filteredEmbeddingModels.map((model) => (
                  <Text key={model.value} fontSize="sm" paddingY={1}>
                    {model.label}
                  </Text>
                ))}
              </Box>
            </Card>
          </VStack>
        )}

        {filteredChatModels.length === 0 && filteredEmbeddingModels.length === 0 && (
          <NoDataInfoBlock
            size="line"
            title="No models found"
            action={search ? { label: "Clear search", onClick: () => setSearch("") } : void 0}
          />
        )}
      </VStack>
    </Dialog>
  );
}
