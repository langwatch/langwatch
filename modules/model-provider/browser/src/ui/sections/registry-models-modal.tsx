import { Card } from "@langwatch/design-system/card";
import { Dialog } from "@langwatch/design-system/dialog";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Box, HStack, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { SmallLabel } from "@langwatch/design-system/small-label";
import { getProviderModelOptions } from "@langwatch/model-provider-contract";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

type RegistryModelsModalProps = {
  open: boolean;
  onClose: () => void;
  provider: string;
  /** `card` keeps the card ground the onboarding page gives its dialogs. */
  ground?: "card";
};

/**
 * Read-only modal that displays all registry models for a given provider.
 * Provides a search input to filter models by name.
 * Groups models into Chat and Embedding sections.
 */
export function RegistryModelsModal({ open, onClose, provider, ground }: RegistryModelsModalProps) {
  const [search, setSearch] = useState("");

  const chatModels = useMemo(() => getProviderModelOptions(provider, "chat"), [provider]);

  const embeddingModels = useMemo(() => getProviderModelOptions(provider, "embedding"), [provider]);

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
      title="Registry models"
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
