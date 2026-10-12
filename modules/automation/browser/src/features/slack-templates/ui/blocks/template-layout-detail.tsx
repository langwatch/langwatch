import { Card } from "@langwatch/design-system/card";
import { Badge, Box, HStack, Stack, Text } from "@langwatch/design-system/primitives";

import { GATED_NOTE, type LayoutRow } from "../elements/layout-rows.ts";

interface Props {
  row: LayoutRow;
  /** The highlighted option in the list points here as its description, so
   *  this pane is read out with the option a screen reader lands on. */
  id: string;
}

/** The highlighted layout's preview: its wireframe, what it shows, and whether it is the default
 *  or locked. */
export function TemplateLayoutDetail({ row, id }: Props) {
  const { option, isLocked, isDefault } = row;
  const { Wireframe } = option;
  return (
    <Stack id={id} data-testid="layout-preview" align="stretch">
      <Card padding="sm" bodyLayout="spaced">
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
        <Card variant="nested" tone="neutral" borderTone="muted" padding="sm">
          <Box minHeight="150px">
            <Wireframe />
          </Box>
        </Card>
        <HStack gap={2} wrap="wrap">
          <Badge size="xs" variant="surface">
            {option.deliveryNote}
          </Badge>
          {isLocked ? (
            <Badge size="xs" variant="subtle" colorPalette="gray">
              {GATED_NOTE}
            </Badge>
          ) : null}
        </HStack>
        <Text textStyle="xs" color="fg.muted">
          {option.tagline}
        </Text>
      </Card>
    </Stack>
  );
}
