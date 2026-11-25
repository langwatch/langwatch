import { Box, chakra, Flex, Text, VStack } from "@langwatch/design-system/primitives";
import { Sparkles } from "lucide-react";

import type { GuidedDeploymentField } from "../../model/guided-credential-fields.ts";
import { GuidedFieldLabel } from "./guided-provider-panel.tsx";

/** The refusal that names the chosen model, read under the model field. */
function GuidedModelError({ error }: { error: string }) {
  return (
    <Text textStyle="caption" mt={1} color="fg.error" role="alert">
      {error}
    </Text>
  );
}

/** A typed model or deployment name, with the hint that says when to type it. */
function GuidedTypedModelInput({
  label,
  value,
  onType,
  placeholder,
  locked,
  hint,
  error,
}: {
  label: string;
  value: string;
  onType: (model: string) => void;
  placeholder: string | undefined;
  locked: boolean;
  hint: string;
  error?: string;
}) {
  return (
    <chakra.label display="block">
      <GuidedFieldLabel>{label}</GuidedFieldLabel>
      <chakra.input
        textStyle="monoSm"
        aria-label={label}
        value={value}
        onChange={(e) => onType(e.target.value)}
        placeholder={placeholder}
        disabled={locked}
        aria-invalid={error ? true : undefined}
        w="full"
        borderRadius="12px"
        border="1px solid"
        borderColor={error ? "fg.error" : "border"}
        bg="bg.page"
        px={3}
        py={2.5}
        outline="none"
        _placeholder={{ color: "fg.subtle" }}
        _focus={{ borderColor: "border.emphasized" }}
      />
      {error ? (
        <GuidedModelError error={error} />
      ) : (
        <Text textStyle="micro" as="span" display="block" mt={1} color="fg.subtle">
          {hint}
        </Text>
      )}
    </chakra.label>
  );
}

/**
 * The guided panel's model: catalog pills, recommendation first, or a typed model name. Azure
 * gets both: OpenAI's pills, and a deployment name for one that differs from the model.
 */
export function GuidedChatModelField({
  guidedModels,
  pickedModel,
  typedModel,
  onPick,
  onType,
  locked,
  providerName,
  modelPlaceholder,
  deploymentField,
  error,
}: {
  guidedModels: string[];
  pickedModel: string | undefined;
  typedModel: string;
  onPick: (model: string) => void;
  onType: (model: string) => void;
  /** While the key is checked or saved, and once connected, the pick stays as it is. */
  locked: boolean;
  providerName: string;
  modelPlaceholder: string | undefined;
  deploymentField: GuidedDeploymentField | undefined;
  /** A refusal naming the model (Azure's missing deployment); it reads here, not under a key. */
  error?: string;
}) {
  if (guidedModels.length === 0) {
    return (
      <GuidedTypedModelInput
        label="Chat model"
        value={typedModel}
        onType={onType}
        placeholder={modelPlaceholder}
        locked={locked}
        hint={`Type it exactly as deployed: ${providerName} has no model list we can read for you.`}
      />
    );
  }

  return (
    <VStack align="stretch" gap={3}>
      <GuidedModelPills
        guidedModels={guidedModels}
        pickedModel={typedModel.trim() ? undefined : pickedModel}
        onPick={onPick}
        locked={locked}
      />
      {deploymentField && (
        <GuidedTypedModelInput
          label={deploymentField.label}
          value={typedModel}
          onType={onType}
          placeholder={deploymentField.placeholder}
          locked={locked}
          hint={deploymentField.hint}
          error={error}
        />
      )}
    </VStack>
  );
}

/** The catalog pills, the recommendation first and marked. */
function GuidedModelPills({
  guidedModels,
  pickedModel,
  onPick,
  locked,
}: {
  guidedModels: string[];
  pickedModel: string | undefined;
  onPick: (model: string) => void;
  locked: boolean;
}) {
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
              textStyle="monoSm"
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
              px={2.5}
              py={1}
              cursor="pointer"
              _hover={{ borderColor: picked ? "fg" : "border.emphasized" }}
              _disabled={{ cursor: "default" }}
            >
              {picked && <Sparkles size={11} />}
              {model}
              {index === 0 && picked && (
                <Text
                  textStyle="micro"
                  fontWeight="medium"
                  as="span"
                  fontFamily="body"
                  opacity={0.7}
                >
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
