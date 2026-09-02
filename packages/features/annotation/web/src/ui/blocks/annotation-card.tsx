import { Box, Button, HStack, Icon, Spacer, Text, VStack } from "@chakra-ui/react";
import { describeAnnotationAnchor } from "@langwatch/annotation-contract";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Crosshair, Lightbulb, MessageCircle, Pencil, ThumbsDown, ThumbsUp } from "lucide-react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { z } from "zod";
import type { AnnotationWithUser } from "@langwatch/annotation-contract";
import type { AnnotationUser } from "../../model/annotation-row";

interface ScoreEntry {
  name: string;
  value: string;
  reason: string | null;
}

const scoreOptionsSchema = z.record(z.string(), z.unknown());
const scoreEntrySchema = z.object({
  value: z.unknown().optional(),
  reason: z.unknown().optional(),
});

interface AnnotationCardProps {
  annotation: AnnotationWithUser;
  /** Renders the host application's avatar primitive. */
  renderAvatar: (user: AnnotationUser) => ReactNode;
  /** The currently open trace, used to decide whether an anchor can jump. */
  openTraceId?: string | null;
  /** Moves the host trace view to an annotation anchor. */
  onJumpToAnchor?: (target: {
    traceId: string;
    anchorKind: string | null;
    anchorId: string | null;
    anchorPath: string | null;
  }) => void;
  /** Score key names by id, so a card never falls back to a raw id. */
  scoreNamesById: Map<string, string>;
  /**
   * The trace the reader is already looking at, when the card sits inside it.
   * A comment on that trace's own field then names the field alone.
   */
  contextTraceId?: string;
  /** Whether the reader wrote this annotation and may change it. */
  isOwn: boolean;
  onEdit: () => void;
}

/**
 * One annotation as it reads beside its turn: who wrote it, when, what they
 * said, how they rated it, and the correction they suggested. Everything is
 * display only. Editing happens in the composer that docks in the card's
 * place, and only the author gets there.
 */
export function AnnotationCard({
  annotation,
  scoreNamesById,
  contextTraceId,
  isOwn,
  onEdit,
  renderAvatar,
  openTraceId,
  onJumpToAnchor,
}: AnnotationCardProps) {
  return (
    <Box
      role={isOwn ? "button" : void 0}
      tabIndex={isOwn ? 0 : void 0}
      aria-label={isOwn ? "Edit annotation" : void 0}
      // The rail's empty area starts a new annotation; a card is a target of
      // its own and must not also read as empty space.
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        if (isOwn) onEdit();
      }}
      // The card carries a button's role, so it owes a button's keyboard.
      onKeyDown={(e: KeyboardEvent) => {
        if (!isOwn || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        e.stopPropagation();
        onEdit();
      }}
      cursor={isOwn ? "pointer" : "default"}
      borderRadius="md"
      borderWidth="1px"
      borderColor="border.muted"
      bg="bg.subtle"
      paddingX={3}
      paddingY={2.5}
      _hover={isOwn ? { bg: "bg.muted" } : void 0}
      transition="background 0.12s ease"
    >
      <VStack align="stretch" gap={2}>
        <CardHeader annotation={annotation} isOwn={isOwn} renderAvatar={renderAvatar} />

        <AnchorBreadcrumb
          annotation={annotation}
          contextTraceId={contextTraceId}
          openTraceId={openTraceId}
          onJumpToAnchor={onJumpToAnchor}
        />

        {annotation.comment && (
          <Text textStyle="xs" whiteSpace="pre-wrap">
            {annotation.comment}
          </Text>
        )}

        <ScoreBadges scores={resolveScores(annotation.scoreOptions, scoreNamesById)} />

        <SuggestedCorrection expectedOutput={annotation.expectedOutput} />
      </VStack>
    </Box>
  );
}

/**
 * The part of the trace the comment is about, when it is about one. A comment
 * about the trace as a whole names nothing: the card is already beside the turn
 * it belongs to, so a chip saying so would be noise on every card.
 *
 * Naming the part is only half of it: the chip takes the reader there, which
 * means the trace view with that span selected and its row brought into
 * view. That only works for the turn the drawer has open, so a comment on
 * another turn's span names its part and leaves the reader to open that turn.
 */
function AnchorBreadcrumb({
  annotation,
  contextTraceId,
  openTraceId,
  onJumpToAnchor,
}: {
  annotation: AnnotationWithUser;
  contextTraceId?: string;
  openTraceId?: string | null;
  onJumpToAnchor?: (target: {
    traceId: string;
    anchorKind: string | null;
    anchorId: string | null;
    anchorPath: string | null;
  }) => void;
}) {
  const anchorKind =
    annotation.anchorKind === "field" ||
    annotation.anchorKind === "message" ||
    annotation.anchorKind === "span"
      ? annotation.anchorKind
      : null;
  const label = describeAnnotationAnchor({
    anchor: {
      anchorKind,
      anchorId: annotation.anchorId,
      anchorPath: annotation.anchorPath,
    },
    traceId: annotation.traceId,
    // Inside the trace the comment is on, naming the trace again says nothing
    // the reader cannot already see.
    selfLabel: contextTraceId === annotation.traceId ? null : "Trace",
  });
  if (!label) return null;

  const jump = onJumpToAnchor;
  const canJump =
    annotation.traceId === openTraceId &&
    (annotation.anchorKind === "span" || annotation.anchorKind === "field") &&
    jump !== void 0;
  if (!canJump || !jump) {
    return (
      <HStack gap={1} maxWidth="full" data-testid="annotation-anchor">
        <Icon as={Crosshair} boxSize={3} color="purple.fg" flexShrink={0} />
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
      alignSelf="flex-start"
      justifyContent="flex-start"
      data-testid="annotation-anchor"
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        jump({
          traceId: annotation.traceId,
          anchorKind: annotation.anchorKind,
          anchorId: annotation.anchorId,
          anchorPath: annotation.anchorPath,
        });
      }}
    >
      <Icon as={Crosshair} boxSize={3} flexShrink={0} />
      <Text textStyle="2xs" truncate>
        Go to {label}
      </Text>
    </Button>
  );
}

/** Who left the annotation, how they rated it, and the way into editing it. */
function CardHeader({
  annotation,
  isOwn,
  renderAvatar,
}: {
  annotation: AnnotationWithUser;
  isOwn: boolean;
  renderAvatar: (user: AnnotationUser) => ReactNode;
}) {
  return (
    <HStack gap={2} align="start">
      <Author annotation={annotation} renderAvatar={renderAvatar} />
      <Spacer />
      <ThumbVerdict isThumbsUp={annotation.isThumbsUp} />
      {isOwn && (
        <Tooltip content="Edit annotation" positioning={{ placement: "top" }}>
          <Icon as={Pencil} boxSize={3} color="fg.muted" />
        </Tooltip>
      )}
    </HStack>
  );
}

function Author({
  annotation,
  renderAvatar,
}: {
  annotation: AnnotationWithUser;
  renderAvatar: (user: AnnotationUser) => ReactNode;
}) {
  return (
    <>
      {renderAvatar({
        id: annotation.user?.id ?? annotation.userId ?? "annotation-api-user",
        name: annotation.user?.name ?? annotation.email ?? "?",
        image: annotation.user?.image,
      })}
      <VStack align="start" gap={0} flex={1} minWidth={0}>
        {annotation.user?.name ? (
          <Text textStyle="xs" fontWeight="600">
            {annotation.user.name}
          </Text>
        ) : (
          <ApiAuthor email={annotation.email ?? null} />
        )}
        <Text textStyle="2xs" color="fg.subtle">
          {annotation.createdAt ? new Date(annotation.createdAt).toLocaleString() : ""}
        </Text>
      </VStack>
    </>
  );
}

/** The thumb a reviewer gave the turn, and nothing at all when they gave none. */
function ThumbVerdict({ isThumbsUp }: { isThumbsUp: AnnotationWithUser["isThumbsUp"] }) {
  if (isThumbsUp === true) {
    return <Icon as={ThumbsUp} boxSize={3.5} color="green.fg" aria-label="Thumbs up" />;
  }
  if (isThumbsUp === false) {
    return <Icon as={ThumbsDown} boxSize={3.5} color="red.fg" aria-label="Thumbs down" />;
  }
  return null;
}

/**
 * An annotation with no LangWatch user behind it came in over the API. Mark it
 * as such and show whatever identity it carried, so it never reads as an
 * anonymous teammate.
 */
function ApiAuthor({ email }: { email: string | null }) {
  return (
    <HStack gap={1.5}>
      <Box
        borderRadius="sm"
        paddingY={0.5}
        paddingX={1.5}
        borderWidth="1px"
        borderColor="border.emphasized"
        textStyle="2xs"
        color="fg.muted"
      >
        API
      </Box>
      <Text textStyle="xs" color="fg.muted">
        {email ?? "anonymous"}
      </Text>
    </HStack>
  );
}

/** Each score the annotation carries, with its reason a hover away. */
function ScoreBadges({ scores }: { scores: ScoreEntry[] }) {
  if (scores.length === 0) return null;
  return (
    <HStack gap={2} wrap="wrap">
      {scores.map((score) => (
        <HStack
          key={score.name}
          gap={1}
          paddingX={1.5}
          paddingY={0.5}
          borderRadius="sm"
          borderWidth="1px"
          borderColor="border.muted"
          bg="bg.panel"
        >
          <Text textStyle="2xs" color="fg.muted" fontWeight="600">
            {score.name}
          </Text>
          <Text textStyle="2xs">{score.value}</Text>
          {score.reason && (
            <Tooltip content={score.reason}>
              <Icon
                as={MessageCircle}
                boxSize={2.5}
                color="fg.muted"
                aria-label={`Reason for ${score.name}`}
              />
            </Tooltip>
          )}
        </HStack>
      ))}
    </HStack>
  );
}

/** The output the reviewer said the turn should have produced. */
function SuggestedCorrection({ expectedOutput }: { expectedOutput: string | null }) {
  if (!expectedOutput) return null;
  return (
    <VStack align="stretch" gap={1}>
      <HStack gap={1}>
        <Icon as={Lightbulb} boxSize={3} color="yellow.fg" />
        <Text textStyle="2xs" color="fg.muted">
          correction
        </Text>
      </HStack>
      <Box
        borderRadius="sm"
        bg="bg.panel"
        borderWidth="1px"
        borderColor="border.muted"
        paddingX={2}
        paddingY={1.5}
        fontSize="xs"
        whiteSpace="pre-wrap"
        maxHeight="160px"
        overflowY="auto"
      >
        {expectedOutput}
      </Box>
    </VStack>
  );
}

/**
 * Turn the stored `{scoreId: {value, reason}}` map into something readable.
 * Ids the project no longer has a name for are dropped rather than rendered
 * raw, and so are keys the reviewer left blank.
 */
function resolveScores(
  scoreOptions: AnnotationWithUser["scoreOptions"],
  scoreNamesById: Map<string, string>,
): ScoreEntry[] {
  const parsed = scoreOptionsSchema.safeParse(scoreOptions);
  if (!parsed.success) return [];
  return Object.entries(parsed.data)
    .map(([id, raw]) => readScoreEntry({ name: scoreNamesById.get(id), raw }))
    .filter((entry): entry is ScoreEntry => entry !== null);
}

/** One stored score, or nothing when it has no name or no value to show. */
function readScoreEntry({
  name,
  raw,
}: {
  name: string | undefined;
  raw: unknown;
}): ScoreEntry | null {
  if (!name) return null;
  const parsed = scoreEntrySchema.safeParse(raw);
  if (!parsed.success) return null;
  const score = parsed.data;
  const value = Array.isArray(score.value) ? score.value.join(", ") : String(score.value ?? "");
  if (!value) return null;
  return { name, value, reason: readReason(score.reason) };
}

function readReason(reason: unknown): string | null {
  if (reason == null || reason === "") return null;
  if (typeof reason === "object") return JSON.stringify(reason);
  return String(reason);
}
