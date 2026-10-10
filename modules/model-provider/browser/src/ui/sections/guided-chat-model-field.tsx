import { Box, chakra, Flex, Text } from "@langwatch/design-system/primitives";
import { Sparkles } from "lucide-react";

import { GuidedFieldLabel } from "./guided-provider-panel.tsx";

/** The guided panel's model: catalog pills, recommendation first, or a typed deployment name. */
export function GuidedChatModelField({
  guidedModels,
  pickedModel,
  onPick,
  locked,
  providerName,
  modelPlaceholder,
}: {
  guidedModels: string[];
  pickedModel: string | undefined;
  onPick: (model: string) => void;
  /** While the key is checked or saved, and once connected, the pick stays as it is. */
  locked: boolean;
  providerName: string;
  modelPlaceholder: string | undefined;
}) {
  if (guidedModels.length === 0) {
    return (
      <chakra.label display="block">
        <GuidedFieldLabel>Chat model</GuidedFieldLabel>
        <chakra.input
          aria-label="Chat model"
          value={pickedModel ?? ""}
          onChange={(e) => onPick(e.target.value)}
          placeholder={modelPlaceholder}
          disabled={locked}
          w="full"
          borderRadius="12px"
          border="1px solid"
          borderColor="border"
          bg="bg.page"
          px={3}
          py={2.5}
          fontFamily="mono"
          fontSize="12.5px"
          outline="none"
          _placeholder={{ color: "fg.subtle" }}
          _focus={{ borderColor: "border.emphasized" }}
        />
        <Text as="span" display="block" mt={1} fontSize="11px" color="fg.subtle">
          Type it exactly as deployed: {providerName} has no model list we can read for you.
        </Text>
      </chakra.label>
    );
  }

  return (
    <Box>
      <GuidedFieldLabel>Default chat model</GuidedFieldLabel>
      <Flex
        wrap="wrap"
        gap={1.5}
        as="fieldset"
        border="0"
        margin="0"
        padding="0"
        aria-label="Default chat model"
      >
        {guidedModels.map((model, index) => {
          const picked = model === pickedModel;
          return (
            <chakra.button
              key={model}
              type="button"
              aria-pressed={picked}
              onClick={() => onPick(model)}
              disabled={locked}
              display="flex"
              alignItems="center"
              gap={1.5}
              borderRadius="full"
              border="1px solid"
              borderColor={picked ? "fg" : "border"}
              bg={picked ? "bg.muted" : "transparent"}
              color={picked ? "fg" : "fg.muted"}
              fontFamily="mono"
              fontSize="11.5px"
              fontWeight={picked ? "600" : "400"}
              px={2.5}
              py={1}
              cursor="pointer"
              _hover={{ borderColor: picked ? "fg" : "border.emphasized" }}
              _disabled={{ cursor: "default" }}
            >
              {picked && <Sparkles size={11} />}
              {model}
              {index === 0 && picked && (
                <Text as="span" fontFamily="body" fontSize="9.5px" fontWeight="500" opacity={0.7}>
                  recommended
                </Text>
              )}
            </chakra.button>
          );
        })}
      </Flex>
    </Box>
  );
}
