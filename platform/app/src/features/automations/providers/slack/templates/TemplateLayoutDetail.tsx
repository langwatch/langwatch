import { Badge, Box, HStack, Stack, Text } from "@chakra-ui/react";
import { GATED_NOTE, type LayoutRow } from "./layoutRows";

interface Props {
  row: LayoutRow;
  /** The highlighted option in the list points here as its description, so
   *  this pane is read out with the option a screen reader lands on. */
  id: string;
}

export function TemplateLayoutDetail({ row, id }: Props) {
  const { option, locked, isDefault } = row;
  const { Wireframe } = option;
  return (
    <Stack
      id={id}
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
        <Text textStyle="md" aria-hidden>
          {option.emoji}
        </Text>
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
    </Stack>
  );
}
