import { chakra, Flex, Text, VStack } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import type { ComponentProps } from "react";

import { SmallLabel } from "../elements/small-label.tsx";
import { CustomModelInputSection } from "./model-provider-custom-model-input.tsx";

type CustomModelProps = ComponentProps<typeof CustomModelInputSection>;

/** The guided panel's model: catalog pills, recommendation first, or a typed deployment name. */
export function GuidedChatModelField({
  actions,
  guidedModels,
  pickedModel,
  onPick,
  locked,
  provider,
  providerName,
  state,
}: {
  actions: CustomModelProps["actions"];
  guidedModels: string[];
  pickedModel: string | undefined;
  onPick: (model: string) => void;
  /** While the key is checked or saved, and once connected, the pick stays as it is. */
  locked: boolean;
  provider: CustomModelProps["provider"];
  providerName: string;
  state: CustomModelProps["state"];
}) {
  if (guidedModels.length === 0) {
    return (
      <VStack align="stretch" width="full" gap={1}>
        <CustomModelInputSection state={state} actions={actions} provider={provider} />
        <Text fontSize="xs" color="fg.subtle">
          Type it exactly as deployed: {providerName} has no model list we can read for you.
        </Text>
      </VStack>
    );
  }

  return (
    <VStack align="stretch" width="full" gap={1}>
      <SmallLabel>Default chat model</SmallLabel>
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
    </VStack>
  );
}
