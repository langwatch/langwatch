/**
 * A board's header, after the reference: the title with its rename pencil, the
 * share control and "Add chart" on the first row, the description and period
 * on the second. Without `onRename`/`onDescribe` the name and description stay fixed.
 */

import { Box, Button, Heading, HStack, IconButton, Spacer, Text, VStack } from "@chakra-ui/react";
import type { DashboardVisibility } from "@langwatch/dashboard-contract";
import { Building2, type LucideIcon, Pencil, Plus, Star, Users } from "lucide-react";
import { useState, type ReactNode } from "react";

import { boardVisibilityLabel } from "../../model/board-visibility.ts";
import { InlineTextField } from "../elements/inline-text-field.tsx";

/** The prototype's tinted chip beside the title for a board shown beyond its creator. */
const SHARED_CHIPS: Partial<
  Readonly<Record<DashboardVisibility, { icon: LucideIcon; palette: string }>>
> = {
  team: { icon: Users, palette: "blue" },
  organisation: { icon: Building2, palette: "orange" },
};

export function BoardHeader({
  name,
  description,
  visibility,
  onRename,
  onDescribe,
  onAddChart,
  periodControl,
  shareControl,
  refreshControl,
}: {
  name: string;
  description: string;
  visibility: DashboardVisibility;
  onRename?: (name: string) => void;
  onDescribe?: (description: string) => void;
  onAddChart: () => void;
  periodControl: ReactNode;
  /** The share icon: the board's visibility menu. */
  shareControl: ReactNode;
  /** Data age and the auto-refresh menu. */
  refreshControl?: ReactNode;
}) {
  return (
    <VStack align="stretch" gap={2} marginBottom={5}>
      <HStack gap={3}>
        <HStack gap={2.5} flex={1} minWidth={0}>
          <Box color="teal.solid" flexShrink={0}>
            <Star size={16} aria-hidden />
          </Box>
          <BoardTitle name={name} onRename={onRename} />
          <SharedChip visibility={visibility} />
        </HStack>
        <HStack gap={3} flexShrink={0}>
          {refreshControl}
          {shareControl}
          <Button
            variant="outline"
            height={8}
            paddingX={3}
            gap={1.5}
            borderRadius="lg"
            borderColor="border"
            fontSize="13px"
            fontWeight="medium"
            _hover={{ borderColor: "border.emphasized", background: "bg.muted" }}
            onClick={onAddChart}
          >
            <Plus size={15} strokeWidth={2} /> Add chart
          </Button>
        </HStack>
      </HStack>
      <HStack columnGap={4} rowGap={2} flexWrap="wrap">
        <BoardDescription description={description} onDescribe={onDescribe} />
        <Spacer />
        {periodControl}
      </HStack>
    </VStack>
  );
}

function SharedChip({ visibility }: { visibility: DashboardVisibility }) {
  const chip = SHARED_CHIPS[visibility];
  if (!chip) return null;
  const Icon = chip.icon;
  return (
    <HStack
      as="span"
      gap={1}
      flexShrink={0}
      borderRadius="sm"
      background={`${chip.palette}.50`}
      color={`${chip.palette}.600`}
      paddingX={1.5}
      paddingY={0.5}
      fontSize="10px"
      fontWeight="medium"
    >
      <Icon size={11} aria-hidden /> {boardVisibilityLabel(visibility)}
    </HStack>
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
      {/* The reference's 19px board title, a step under the standard page heading. */}
      <Heading as="h1" truncate fontSize="19px" fontWeight="semibold" letterSpacing="tight">
        {name}
      </Heading>
      {onRename && (
        <IconButton
          aria-label="Rename dashboard"
          title="Rename dashboard"
          variant="ghost"
          size="2xs"
          minWidth={0}
          padding={1}
          borderRadius="md"
          color="gray.400"
          _hover={{ background: "bg.muted", color: "fg" }}
          flexShrink={0}
          onClick={() => setRenaming(true)}
        >
          <Pencil size={13} />
        </IconButton>
      )}
    </>
  );
}

const DESCRIPTION_TEXT = {
  variant: "plain",
  size: "sm",
  height: "auto",
  paddingX: 0,
  fontWeight: "normal",
  fontSize: "12.5px",
} as const;

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
      <Text fontSize="12.5px" color="fg.subtle">
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
        {...DESCRIPTION_TEXT}
        color="fg.subtle"
        _hover={{ color: "fg" }}
        title="Edit description"
        onClick={() => setEditing(true)}
      >
        {description}
      </Button>
    );
  }

  return (
    <Button
      {...DESCRIPTION_TEXT}
      fontStyle="italic"
      color="gray.400"
      _hover={{ color: "fg.subtle" }}
      onClick={() => setEditing(true)}
    >
      Add a description
    </Button>
  );
}
