import { Box, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { CustomModelEntry } from "../../server/modelProviders/customModel.schema";
import { getProviderModelOptions } from "../../server/modelProviders/registry";
import { SmallLabel } from "../SmallLabel";
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "../ui/dialog";

type RegistryModelsModalProps = {
  open: boolean;
  onClose: () => void;
  provider: string;
  /**
   * The provider's own models, listed instead of the catalog. Passed for a
   * custom provider, whose models are the ones it serves rather than any in
   * the catalog.
   */
  providerModels?: CustomModelEntry[];
  /** Override DialogContent background (e.g. "bg.surface" for solid on onboarding). */
  dialogBackground?: string;
};

type ModelOption = { value: string; label: string };

function optionsFor(
  entries: CustomModelEntry[],
  mode: CustomModelEntry["mode"],
): ModelOption[] {
  return entries
    .filter((entry) => entry.mode === mode)
    .map((entry) => ({ value: entry.modelId, label: entry.displayName }));
}

/**
 * Read-only modal that displays all registry models for a given provider,
 * or the provider's own models when `providerModels` is given.
 * Provides a search input to filter models by name.
 * Groups models into Chat and Embedding sections.
 */
export function RegistryModelsModal({
  open,
  onClose,
  provider,
  providerModels,
  dialogBackground,
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
      (m) =>
        m.value.toLowerCase().includes(term) ||
        m.label.toLowerCase().includes(term),
    );
  }, [chatModels, search]);

  const filteredEmbeddingModels = useMemo(() => {
    if (!search.trim()) return embeddingModels;
    const term = search.toLowerCase();
    return embeddingModels.filter(
      (m) =>
        m.value.toLowerCase().includes(term) ||
        m.label.toLowerCase().includes(term),
    );
  }, [embeddingModels, search]);

  const handleClose = () => {
    setSearch("");
    onClose();
  };

  return (
    <DialogRoot
      open={open}
      onOpenChange={(e) => !e.open && handleClose()}
      size="lg"
    >
      <DialogContent
        {...(dialogBackground ? { background: dialogBackground } : {})}
      >
        <DialogHeader>
          <DialogTitle>
            {providerModels ? "Provider Models" : "Registry Models"}
          </DialogTitle>
        </DialogHeader>
        <DialogCloseTrigger />
        <DialogBody>
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
                <Box
                  maxHeight="200px"
                  overflowY="auto"
                  borderWidth="1px"
                  borderRadius="md"
                  padding={2}
                >
                  {filteredChatModels.map((model) => (
                    <Text key={model.value} fontSize="sm" paddingY={1}>
                      {model.label}
                    </Text>
                  ))}
                </Box>
              </VStack>
            )}

            {filteredEmbeddingModels.length > 0 && (
              <VStack gap={2} align="stretch">
                <SmallLabel>Embedding Models</SmallLabel>
                <Box
                  maxHeight="200px"
                  overflowY="auto"
                  borderWidth="1px"
                  borderRadius="md"
                  padding={2}
                >
                  {filteredEmbeddingModels.map((model) => (
                    <Text key={model.value} fontSize="sm" paddingY={1}>
                      {model.label}
                    </Text>
                  ))}
                </Box>
              </VStack>
            )}

            {filteredChatModels.length === 0 &&
              filteredEmbeddingModels.length === 0 && (
                <Text fontSize="sm" color="fg.muted" textAlign="center">
                  No models found
                </Text>
              )}
          </VStack>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  );
}
