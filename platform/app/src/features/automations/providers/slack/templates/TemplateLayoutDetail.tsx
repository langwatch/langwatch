import { Badge, Box, HStack, Stack, Text } from "@chakra-ui/react";
import { GATED_NOTE, type LayoutRow } from "./layoutRows";
import type { DraftCadence } from "./registry";

interface Props {
  row: LayoutRow;
  /** Set when applying this layout also moves the automation to the other
   *  cadence, so the author reads the consequence before they pick it. */
  switchesCadenceTo?: DraftCadence;
}

function cadenceSwitchNote(target: DraftCadence): string {
  return target === "digest"
    ? "Picking this layout bundles the window's matches into one message, on a 5 minute digest. You can change the window in the Cadence section."
    : "Picking this layout sends one message per matching trace, on the Immediate cadence.";
}

export function TemplateLayoutDetail({ row, switchesCadenceTo }: Props) {
  const { option, locked, isDefault } = row;
  const { Wireframe } = option;
  return (
    <Stack
      data-testid="layout-preview"
      gap={3}
      align="stretch"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      bg="bg.panel/60"
      padding={3}
    >
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
        padding={3}
        bg="bg.subtle"
        minHeight="150px"
      >
        <Wireframe />
      </Box>
      <HStack gap={2} wrap="wrap">
        <Badge size="xs" variant="surface">
          {option.deliveryNote}
        </Badge>
        {locked ? (
          <Badge size="xs" variant="subtle" colorPalette="gray">
            {GATED_NOTE}
          </Badge>
        ) : null}
      </HStack>
      <Text textStyle="xs" color="fg.muted">
        {option.tagline}
      </Text>
      {switchesCadenceTo ? (
        <Text textStyle="xs" color="fg.muted">
          {cadenceSwitchNote(switchesCadenceTo)}
        </Text>
      ) : null}
    </Stack>
  );
}
