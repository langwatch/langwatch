/**
 * A board's header, after the reference: the title with its rename pencil, the
 * share control and "Add chart" on the first row, the description and period
 * on the second. Without `onRename`/`onDescribe` the board is read-only.
 */

import { Badge, Box, Button, HStack, IconButton, Spacer, Text, VStack } from "@chakra-ui/react";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Gauge, Pencil, Plus, Star } from "lucide-react";
import { useState, type ReactNode } from "react";

import { InlineTextField } from "../elements/inline-text-field.tsx";

export function BoardHeader({
  name,
  isDefault,
  description,
  onRename,
  onDescribe,
  onAddChart,
  periodControl,
  visibilityControl,
}: {
  name: string;
  isDefault: boolean;
  description: string;
  onRename?: (name: string) => void;
  onDescribe?: (description: string) => void;
  onAddChart: () => void;
  periodControl: ReactNode;
  /** The share control; the Flight Deck has none. */
  visibilityControl?: ReactNode;
}) {
  return (
    <VStack align="stretch" gap={2} paddingX={6} paddingTop={5} paddingBottom={2}>
      <HStack gap={3}>
        <HStack gap={2.5} flex={1} minWidth={0}>
          <Box color="teal.fg" flexShrink={0}>
            {isDefault ? <Gauge size={16} aria-hidden /> : <Star size={16} aria-hidden />}
          </Box>
          <BoardTitle name={name} onRename={onRename} />
          {isDefault && (
            <Badge size="sm" variant="subtle" flexShrink={0}>
              Default
            </Badge>
          )}
        </HStack>
        {visibilityControl}
        <Button variant="outline" size="sm" flexShrink={0} onClick={onAddChart}>
          <Plus size={14} /> Add chart
        </Button>
      </HStack>
      <HStack gap={4} flexWrap="wrap">
        <BoardDescription description={description} onDescribe={onDescribe} />
        <Spacer />
        {periodControl}
      </HStack>
    </VStack>
  );
}

function BoardTitle({ name, onRename }: { name: string; onRename?: (name: string) => void }) {
  const [renaming, setRenaming] = useState(false);

  if (onRename && renaming) {
    return (
      <InlineTextField
        value={name}
        label="Dashboard name"
        fontSize="19px"
        fontWeight="semibold"
        size="sm"
        maxWidth="md"
        onCancel={() => setRenaming(false)}
        onCommit={(draft) => {
          setRenaming(false);
          const trimmed = draft.trim();
          if (trimmed && trimmed !== name) onRename(trimmed);
        }}
      />
    );
  }

  return (
    <>
      <PageLayout.Heading truncate>{name}</PageLayout.Heading>
      {onRename && (
        <IconButton
          aria-label="Rename dashboard"
          title="Rename dashboard"
          variant="ghost"
          size="xs"
          color="fg.subtle"
          flexShrink={0}
          onClick={() => setRenaming(true)}
        >
          <Pencil size={13} />
        </IconButton>
      )}
    </>
  );
}

function BoardDescription({
  description,
  onDescribe,
}: {
  description: string;
  onDescribe?: (description: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (!onDescribe) {
    return (
      <Text fontSize="13px" color="fg.muted">
        {description}
      </Text>
    );
  }

  if (editing) {
    return (
      <InlineTextField
        value={description}
        label="Dashboard description"
        placeholder="Describe this dashboard"
        size="xs"
        maxWidth="lg"
        onCancel={() => setEditing(false)}
        onCommit={(draft) => {
          setEditing(false);
          onDescribe(draft);
        }}
      />
    );
  }

  if (description) {
    return (
      <Button
        variant="plain"
        size="sm"
        paddingX={0}
        fontWeight="normal"
        fontSize="13px"
        color="fg.muted"
        title="Edit description"
        onClick={() => setEditing(true)}
      >
        {description}
      </Button>
    );
  }

  return (
    <Button
      variant="plain"
      size="sm"
      paddingX={0}
      fontWeight="normal"
      fontSize="13px"
      fontStyle="italic"
      color="fg.subtle"
      onClick={() => setEditing(true)}
    >
      Add a description
    </Button>
  );
}
