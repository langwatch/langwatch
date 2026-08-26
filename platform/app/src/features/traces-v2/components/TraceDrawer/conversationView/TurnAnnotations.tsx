import { Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { Lightbulb, MessageSquare, Pencil } from "lucide-react";
import { useState } from "react";
import { UserAvatar } from "~/components/UserAvatar";
import { Checkbox } from "~/components/ui/checkbox";
import { Popover } from "~/components/ui/popover";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import { isSessionMarked, useAnnotationQueueSessionStore } from "@langwatch/trace-web";
import {
  openTraceEditorFromConversation,
  tracePartitionHint,
} from "../../../utils/traceEditMode";
import { AnnotationPopover } from "./AnnotationPopover";
import { HoverActionButton, HoverActionCluster } from "./HoverActionCluster";

type AnnotationItem = RouterOutputs["annotation"]["getByTraceIds"][number];

/**
 * The one action the turn separator carries: opening the turn's trace where a
 * correction can be written.
 *
 * Everything said about a message is said on the message itself, so the
 * separator is left with the one thing that is about the turn rather than
 * about either side of it. Correcting a trace is what the annotation queue's
 * own Edit trace does, and it asks for the same permission here.
 */
export function TurnEditTraceAction({
  traceId,
  occurredAtMs,
}: {
  traceId: string;
  /** When the turn ran, which tells the drawer where to look for it. */
  occurredAtMs?: number | null;
}) {
  const { hasPermission } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();

  if (!hasPermission("annotations:update")) return null;

  return (
    <HoverActionCluster label="Turn actions">
      <HoverActionButton
        icon={Pencil}
        label="Edit trace"
        tooltip="Open this turn's trace to correct it"
        onActivate={() =>
          openTraceEditorFromConversation({
            openDrawer,
            traceId,
            occurredAtMs: tracePartitionHint(occurredAtMs),
          })
        }
      />
    </HoverActionCluster>
  );
}

/**
 * Whether this turn's trace is one the sitting at the queue counts.
 *
 * Annotating a turn counts it on its own, so the box is mostly a way to
 * disagree: to keep a trace the reviewer only read, or to drop one they
 * annotated and thought better of.
 */
export function TurnSessionCheckbox({ traceId }: { traceId: string }) {
  const isMarked = useAnnotationQueueSessionStore((s) =>
    isSessionMarked(s.marks, traceId),
  );
  const toggle = useAnnotationQueueSessionStore((s) => s.toggle);

  return (
    <Checkbox
      size="sm"
      checked={isMarked}
      onCheckedChange={() => toggle(traceId)}
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      inputProps={{
        "aria-label": "Count this turn in the annotation session",
      }}
    />
  );
}

interface TurnAnnotationBadgesProps {
  traceId: string;
  output?: string | null;
  /**
   * Annotations sourced from the conversation-level `getByTraceIds` query.
   * When provided, this badge skips its own per-trace fetch — avoids N
   * queries for an N-turn conversation.
   */
  prefetchedItems?: AnnotationItem[];
}

/**
 * Compact inline indicators showing this turn already carries an annotation
 * and/or a suggested correction. Clicking the badge pops a small list of
 * who annotated; clicking an entry opens it in the edit popover. Replaces
 * the redundant inline panel that used to live below the bubbles.
 */
export function TurnAnnotationBadges({
  traceId,
  output,
  prefetchedItems,
}: TurnAnnotationBadgesProps) {
  const { project, hasPermission } = useOrganizationTeamProject();
  const [listOpen, setListOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // What the turn carries is what was said about the turn. A comment about one
  // of its spans reads beside it in the rail and is counted nowhere, so one
  // reviewer marking up six steps of a turn leaves its count where it was.
  const annotations = api.annotation.getByTraceId.useQuery(
    { projectId: project?.id ?? "", traceId, anchor: "trace" },
    {
      enabled:
        !!project?.id &&
        hasPermission("annotations:view") &&
        prefetchedItems === undefined,
    },
  );

  const items = prefetchedItems ?? annotations.data ?? [];
  const annotationCount = items.length;
  const hasCorrection = items.some((a) => a.expectedOutput);
  const canEdit = hasPermission("annotations:manage");

  if (annotationCount === 0) return null;

  return (
    <Popover.Root
      open={listOpen}
      onOpenChange={(e) => setListOpen(e.open)}
      positioning={{
        placement: "bottom-end",
        flip: true,
        shift: 16,
        overflowPadding: 16,
      }}
    >
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="2xs"
          onClick={(e) => e.stopPropagation()}
          aria-label={`${annotationCount} annotation${
            annotationCount === 1 ? "" : "s"
          } on this turn`}
          flexShrink={0}
          paddingX={1.5}
          paddingY={0.5}
          height="auto"
          borderRadius="sm"
          bg="amber.subtle"
          color="amber.fg"
          _hover={{ bg: "amber.subtle", filter: "brightness(1.1)" }}
          gap={1}
        >
          <Icon as={MessageSquare} boxSize={3} />
          <Text textStyle="2xs" fontWeight="600">
            {annotationCount}
          </Text>
          {hasCorrection && <Icon as={Lightbulb} boxSize={3} color="yellow.fg" />}
        </Button>
      </Popover.Trigger>
      <Popover.Content
        width="320px"
        bg="bg.panel/92"
        onClick={(e) => e.stopPropagation()}
      >
        <Popover.Arrow />
        <Popover.Body padding={1.5}>
          <VStack align="stretch" gap={0.5}>
            {items.map((a) => (
              <AnnotationListRow
                key={a.id}
                annotation={a}
                traceId={traceId}
                output={output}
                canEdit={canEdit}
                isEditing={editingId === a.id}
                onEditingChange={(open) => setEditingId(open ? a.id : null)}
              />
            ))}
          </VStack>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}

/**
 * One annotation in the badge's list, and the way into editing it.
 *
 * For a reviewer who may edit, the line itself is the button that opens the
 * correction popover: it anchors the form where the reviewer was reading, it
 * answers Enter and Space like any button, and closing hands the keyboard back
 * to it. For everyone else it is text.
 */
function AnnotationListRow({
  annotation,
  traceId,
  output,
  canEdit,
  isEditing,
  onEditingChange,
}: {
  annotation: AnnotationItem;
  traceId: string;
  output?: string | null;
  canEdit: boolean;
  isEditing: boolean;
  onEditingChange: (open: boolean) => void;
}) {
  const summary = <AnnotationListRowSummary annotation={annotation} />;

  if (!canEdit) {
    return (
      <Box textAlign="left" paddingX={2} paddingY={1.5} borderRadius="sm">
        {summary}
      </Box>
    );
  }

  return (
    <AnnotationPopover
      traceId={traceId}
      output={output}
      mode={annotation.expectedOutput ? "suggest" : "annotate"}
      annotationId={annotation.id}
      open={isEditing}
      onOpenChange={onEditingChange}
      trigger={
        <Box
          as="button"
          width="full"
          textAlign="left"
          cursor="pointer"
          paddingX={2}
          paddingY={1.5}
          borderRadius="sm"
          _hover={{ bg: "bg.muted" }}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          {summary}
        </Box>
      }
    />
  );
}

/** Who left the annotation, when, whether it corrects the turn, and what it says. */
function AnnotationListRowSummary({ annotation }: { annotation: AnnotationItem }) {
  return (
    <HStack gap={2} align="start">
      <UserAvatar
        size="xs"
        background="gray.solid"
        color="white"
        name={annotation.user?.name ?? annotation.email ?? "?"}
        image={annotation.user?.image}
      />
      <VStack align="start" gap={0} flex={1} minWidth={0}>
        <HStack gap={1.5} width="full">
          <Text textStyle="2xs" fontWeight="600">
            {annotation.user?.name ?? annotation.email ?? "anonymous"}
          </Text>
          {annotation.expectedOutput && (
            <Icon as={Lightbulb} boxSize={2.5} color="yellow.fg" />
          )}
          <Box flex={1} />
          <Text textStyle="2xs" color="fg.subtle">
            {new Date(annotation.createdAt).toLocaleDateString()}
          </Text>
        </HStack>
        {annotation.comment && (
          <Text textStyle="2xs" color="fg.muted" lineClamp={3}>
            {annotation.comment}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}
