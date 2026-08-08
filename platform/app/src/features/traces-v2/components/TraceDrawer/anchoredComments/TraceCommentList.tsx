import { Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { Crosshair, Lightbulb } from "lucide-react";
import { UserAvatar } from "~/components/UserAvatar";
import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import {
  canJumpToAnnotationAnchor,
  useJumpToAnnotationAnchor,
} from "../../../hooks/useJumpToAnnotationAnchor";
import { describeAnnotationAnchor } from "../../../utils/annotationAnchorLabel";

/** What a comment reads as when the part it was left on is gone. */
const ORPHANED_ANCHOR = "On a part of the trace that is no longer there";

interface TraceCommentListProps {
  /** The trace the drawer has open, whose parts a jump can land on. */
  traceId: string;
  comments: AnnotationByTrace[];
  /** Span names by id, so a breadcrumb reads as the span rather than its id. */
  spanNames: Map<string, string>;
  /**
   * The parts the trace still has: its span ids and its own id. A comment
   * pointing outside this reads as being about a part that is no longer there,
   * and offers nowhere to go.
   */
  resolvable: ReadonlySet<string>;
}

/**
 * Every comment on the trace, each one saying what it is about.
 *
 * This is the one list that holds all of them at once, so it is where a comment
 * whose part the trace no longer has still reads: it says so, and offers no
 * jump, rather than pointing the reader at whatever now sits at that id.
 */
export function TraceCommentList({
  traceId,
  comments,
  spanNames,
  resolvable,
}: TraceCommentListProps) {
  const hasCorrection = comments.some((comment) => comment.expectedOutput);
  return (
    <VStack
      align="stretch"
      gap={3}
      minWidth="300px"
      maxWidth="380px"
      paddingX={3}
      paddingY={2.5}
    >
      <HStack gap={2}>
        <Text textStyle="xs" fontWeight="600">
          {comments.length} annotation{comments.length === 1 ? "" : "s"}
        </Text>
        {hasCorrection && (
          <HStack gap={1} color="yellow.fg">
            <Icon as={Lightbulb} boxSize={3} />
            <Text textStyle="2xs">includes corrections</Text>
          </HStack>
        )}
      </HStack>
      <Box height="1px" bg="border.muted" marginX={-3} />
      <VStack align="stretch" gap={3} maxHeight="280px" overflowY="auto">
        {comments.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            traceId={traceId}
            spanNames={spanNames}
            resolvable={resolvable}
          />
        ))}
      </VStack>
      <Box height="1px" bg="border.muted" marginX={-3} />
      <Text textStyle="2xs" color="fg.subtle">
        Annotations appear beside each turn in the Conversation view.
      </Text>
    </VStack>
  );
}

/** One comment: who left it, what they said, and what it is about. */
function CommentRow({
  comment,
  traceId,
  spanNames,
  resolvable,
}: {
  comment: AnnotationByTrace;
  traceId: string;
  spanNames: Map<string, string>;
  resolvable: ReadonlySet<string>;
}) {
  return (
    <HStack gap={2.5} align="start">
      <UserAvatar
        size="xs"
        background="gray.solid"
        color="white"
        name={comment.user?.name ?? comment.email ?? "?"}
        image={comment.user?.image}
      />
      <VStack align="start" gap={0.5} flex={1} minWidth={0}>
        <HStack gap={1.5} width="full">
          <Text textStyle="2xs" fontWeight="600">
            {comment.user?.name ?? comment.email ?? "anonymous"}
          </Text>
          {comment.expectedOutput && (
            <Icon as={Lightbulb} boxSize={2.5} color="yellow.fg" />
          )}
          <Box flex={1} />
          <Text textStyle="2xs" color="fg.subtle">
            {new Date(comment.createdAt).toLocaleDateString()}
          </Text>
        </HStack>
        <AnchorBreadcrumb
          comment={comment}
          traceId={traceId}
          spanNames={spanNames}
          resolvable={resolvable}
        />
        {comment.comment && (
          <Text textStyle="2xs" color="fg.muted" lineClamp={3}>
            {comment.comment}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}

/**
 * The part of the trace a comment is about: a way there when the trace still
 * has it, a note that it is gone when it does not, and nothing at all for a
 * comment about the trace as a whole, which has nowhere narrower to point.
 */
function AnchorBreadcrumb({
  comment,
  traceId,
  spanNames,
  resolvable,
}: {
  comment: AnnotationByTrace;
  traceId: string;
  spanNames: Map<string, string>;
  resolvable: ReadonlySet<string>;
}) {
  const jump = useJumpToAnnotationAnchor();
  const isOnThisTrace = comment.traceId === traceId;
  const label = describeAnnotationAnchor({
    anchor: comment,
    traceId: comment.traceId,
    spanName: comment.anchorId ? spanNames.get(comment.anchorId) : null,
  });
  if (!label) return null;

  const isGone =
    isOnThisTrace && !!comment.anchorId && !resolvable.has(comment.anchorId);
  if (isGone) {
    return (
      <Text textStyle="2xs" color="fg.subtle" fontStyle="italic">
        {ORPHANED_ANCHOR}
      </Text>
    );
  }

  const canJump =
    isOnThisTrace && canJumpToAnnotationAnchor({ anchor: comment, resolvable });
  if (!canJump) {
    return (
      <HStack gap={1} maxWidth="full">
        <Icon as={Crosshair} boxSize={2.5} color="purple.fg" flexShrink={0} />
        <Text textStyle="2xs" color="purple.fg" truncate title={label}>
          {label}
        </Text>
      </HStack>
    );
  }

  return (
    <Button
      size="2xs"
      variant="ghost"
      color="purple.fg"
      gap={1}
      paddingX={1}
      height="18px"
      maxWidth="full"
      justifyContent="flex-start"
      onClick={() =>
        jump({
          traceId: comment.traceId,
          anchorKind: comment.anchorKind,
          anchorId: comment.anchorId,
          anchorPath: comment.anchorPath,
        })
      }
    >
      <Icon as={Crosshair} boxSize={2.5} flexShrink={0} />
      <Text textStyle="2xs" truncate>
        Go to {label}
      </Text>
    </Button>
  );
}
