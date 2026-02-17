import {
  Box,
  HStack,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { getProviderModelOptions } from "../../server/modelProviders/registry";
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "../ui/dialog";
import { SmallLabel } from "../SmallLabel";

type RegistryModelsModalProps = {
  open: boolean;
  onClose: () => void;
  provider: string;
};

/**
 * Read-only modal that displays all registry models for a given provider.
 * Provides a search input to filter models by name.
 * Groups models into Chat and Embedding sections.
 */
export function RegistryModelsModal({
  open,
  onClose,
  provider,
}: RegistryModelsModalProps) {
  const [search, setSearch] = useState("");

  const chatModels = useMemo(
    () => getProviderModelOptions(provider, "chat"),
    [provider],
  );

  const embeddingModels = useMemo(
    () => getProviderModelOptions(provider, "embedding"),
    [provider],
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
      closeOnInteractOutside={false}
      size="lg"
    >
      <DialogContent positionerProps={{ zIndex: 1502 }}>
        <DialogHeader>
          <DialogTitle>Registry Models</DialogTitle>
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
