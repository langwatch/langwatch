/**
 * A board's header: title (badged on a From LangWatch board, with its scope on a stored one),
 * what peers lend it and one action, then the description, the Project chip of an
 * Organization board and the period. Star and rename live in the sidebar.
 */

import { type BoardHeaderActionProps, BoardHeaderActionToken } from "@langwatch/analytics-client";
import { IsolatedErrorBoundary } from "@langwatch/browser-host/isolated-error-boundary";
import { useLentAll } from "@langwatch/browser-host/lent";
import { Button, Heading, HStack, Spacer, Text, VStack } from "@langwatch/design-system/primitives";
import { Sparkles } from "lucide-react";
import { type ReactNode, Suspense, useState } from "react";

import { InlineTextField } from "../elements/inline-text-field.tsx";

export function BoardHeader({
  name,
  description,
  isFromLangWatch = false,
  scope,
  onDescribe,
  pointer,
  action,
  project,
  periodControl,
}: {
  name: string;
  description: string;
  /** A live From LangWatch template rather than a stored board. */
  isFromLangWatch?: boolean;
  /** A stored board's scope control, beside the title. */
  scope?: ReactNode;
  /** Absent where the reader cannot edit the board. */
  onDescribe?: (description: string) => void;
  /** The board as the actions peers lend the header point at it. */
  pointer: Omit<BoardHeaderActionProps, "boardName">;
  /** "Add a widget" on a board the reader may edit; null where there is nothing to offer. */
  action: ReactNode;
  /** The Project chip of an Organization board: whose data it shows. */
  project?: ReactNode;
  periodControl: ReactNode;
}) {
  return (
    <VStack align="stretch" gap={2} marginBottom={5}>
      <HStack gap={3}>
        <HStack columnGap={2.5} rowGap={1} flex={1} minWidth={0} flexWrap="wrap">
          {/* The prototype's 19px board title, a step under the standard page heading. */}
          <Heading
            as="h1"
            lineClamp={2}
            fontSize="19px"
            fontWeight="semibold"
            letterSpacing="tight"
          >
            {name}
          </Heading>
          {isFromLangWatch && <FromLangWatchBadge />}
          {scope}
        </HStack>
        <HStack flexShrink={0} gap={2}>
          <LentBoardActions boardName={name} {...pointer} />
          {action}
        </HStack>
      </HStack>
      <HStack columnGap={4} rowGap={2} flexWrap="wrap">
        <BoardDescription description={description} onDescribe={onDescribe} />
        <Spacer />
        {project}
        {periodControl}
      </HStack>
    </VStack>
  );
}

/** The actions peers lend the header (§10.1); nothing draws without a lender. */
function LentBoardActions(props: BoardHeaderActionProps) {
  const actions = useLentAll(BoardHeaderActionToken);
  return actions.map(({ owner, Component }) => (
    <IsolatedErrorBoundary key={owner} scope="This action failed to load">
      <Suspense fallback={null}>
        <Component {...props} />
      </Suspense>
    </IsolatedErrorBoundary>
  ));
}

function FromLangWatchBadge() {
  return (
    <HStack
      as="span"
      flexShrink={0}
      gap={1}
      borderRadius="full"
      paddingX={2}
      paddingY={0.5}
      background="purple.50"
      color="purple.600"
      fontSize="10.5px"
      fontWeight="medium"
    >
      <Sparkles size={11} aria-hidden />
      From LangWatch
    </HStack>
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

  if (onDescribe && editing) {
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

  if (!onDescribe) {
    if (!description) return null;
    return (
      <Text fontSize="12.5px" color="fg.muted" truncate minWidth={0}>
        {description}
      </Text>
    );
  }

  return (
    <Button
      variant="plain"
      size="sm"
      height="auto"
      paddingX={0}
      fontWeight="normal"
      fontSize="12.5px"
      color="fg.muted"
      cursor="text"
      _hover={{ color: "fg" }}
      title="Edit description"
      onClick={() => setEditing(true)}
    >
      {description || "Add a description"}
    </Button>
  );
}
