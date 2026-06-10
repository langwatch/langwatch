import {
  Badge,
  Box,
  HStack,
  SimpleGrid,
  Stack,
  Text,
} from "@chakra-ui/react";

import {
  pickDefaultSlackBlockKitTemplateId,
  templateOptionsForCadence,
  type DraftCadence,
  type SlackBlockKitTemplateOption,
} from "./registry";

interface Props {
  cadence: DraftCadence;
  hasEvaluationFilter: boolean;
  /** The current value of slice.template — used to highlight which preset
   *  (if any) matches it. Custom edits highlight nothing. */
  currentSource: string;
  onSelect: (option: SlackBlockKitTemplateOption) => void;
}

export function SlackBlockKitTemplatePicker({
  cadence,
  hasEvaluationFilter,
  currentSource,
  onSelect,
}: Props) {
  const options = templateOptionsForCadence(cadence);
  const defaultId = pickDefaultSlackBlockKitTemplateId({
    cadence,
    hasEvaluationFilter,
  });

  return (
    <Stack gap={2} align="stretch">
      <Text textStyle="xs" color="fg.muted">
        {cadence === "digest"
          ? "Your cadence bundles every trace matched in the window into one digest message. Pick a starting layout — the thumbnail shows structure, not the final look."
          : "Each matching trace sends its own message. Pick a starting layout — the thumbnail shows structure, not the final look."}
      </Text>
      <SimpleGrid
        columns={{ base: 2, md: Math.min(options.length, 3) }}
        gap={3}
        alignItems="stretch"
      >
        {options.map((option) => {
          const isSelected = option.source === currentSource;
          const isDefault = option.id === defaultId;
          return (
            <Card
              key={option.id}
              option={option}
              isSelected={isSelected}
              isDefault={isDefault}
              onClick={() => onSelect(option)}
            />
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}

function Card({
  option,
  isSelected,
  isDefault,
  onClick,
}: {
  option: SlackBlockKitTemplateOption;
  isSelected: boolean;
  isDefault: boolean;
  onClick: () => void;
}) {
  const { Wireframe } = option;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      aria-label={`Use ${option.displayName} template`}
      style={{ textAlign: "left", width: "100%", height: "100%" }}
    >
      <Box
        height="full"
        borderWidth={isSelected ? "2px" : "1px"}
        borderColor={isSelected ? "border.emphasized" : "border"}
        borderRadius="md"
        bg="bg.panel/60"
        padding={3}
        transition="border-color 120ms ease"
        _hover={{ borderColor: "border.emphasized" }}
      >
        <Stack gap={2} align="stretch" height="full">
          <HStack gap={2}>
            <Text textStyle="md">{option.emoji}</Text>
            <Text textStyle="sm" fontWeight="medium">
              {option.displayName}
            </Text>
            {isDefault ? (
              <Badge size="sm" colorPalette="orange" variant="subtle">
                Default
              </Badge>
            ) : null}
          </HStack>
          <Box
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="sm"
            padding={2}
            bg="bg.subtle"
            height="120px"
            overflow="hidden"
            flexShrink={0}
          >
            <Wireframe />
          </Box>
          <Badge size="xs" variant="surface" alignSelf="start">
            {option.deliveryNote}
          </Badge>
          <Text textStyle="xs" color="fg.muted" lineClamp={2}>
            {option.tagline}
          </Text>
        </Stack>
      </Box>
    </button>
  );
}
