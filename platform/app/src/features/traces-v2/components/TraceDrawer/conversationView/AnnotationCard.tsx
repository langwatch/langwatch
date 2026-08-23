import {
  Box,
  Button,
  HStack,
  Icon,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Crosshair,
  Lightbulb,
  MessageCircle,
  Pencil,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { UserAvatar } from "~/components/UserAvatar";
import { Tooltip } from "~/components/ui/tooltip";
import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import { describeAnnotationAnchor } from "~/server/annotations/annotationAnchorLabel";
import { useJumpToAnnotationAnchor } from "../../../hooks/useJumpToAnnotationAnchor";
import { useDrawerStore } from "../../../stores/drawerStore";

interface ScoreEntry {
  name: string;
  value: string;
  reason: string | null;
}

interface AnnotationCardProps {
  annotation: AnnotationByTrace;
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
}: AnnotationCardProps) {
  return (
    <Box
      role={isOwn ? "button" : undefined}
      tabIndex={isOwn ? 0 : undefined}
      aria-label={isOwn ? "Edit annotation" : undefined}
      // The rail's empty area starts a new annotation; a card is a target of
      // its own and must not also read as empty space.
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        if (isOwn) onEdit();
      }}
      // The card carries a button's role, so it owes a button's keyboard.
      onKeyDown={(e: React.KeyboardEvent) => {
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
      _hover={isOwn ? { bg: "bg.muted" } : undefined}
      transition="background 0.12s ease"
    >
      <VStack align="stretch" gap={2}>
        <CardHeader annotation={annotation} isOwn={isOwn} />

        <AnchorBreadcrumb
          annotation={annotation}
          contextTraceId={contextTraceId}
        />

        {annotation.comment && (
          <Text textStyle="xs" whiteSpace="pre-wrap">
            {annotation.comment}
          </Text>
        )}

        <ScoreBadges
          scores={resolveScores(annotation.scoreOptions, scoreNamesById)}
        />

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
}: {
  annotation: AnnotationByTrace;
  contextTraceId?: string;
}) {
  const jump = useJumpToAnnotationAnchor();
  const openTraceId = useDrawerStore((s) => s.traceId);
  const label = describeAnnotationAnchor({
    anchor: annotation,
    traceId: annotation.traceId,
    // Inside the trace the comment is on, naming the trace again says nothing
    // the reader cannot already see.
    selfLabel: contextTraceId === annotation.traceId ? null : "Trace",
  });
  if (!label) return null;

  const canJump =
    annotation.traceId === openTraceId &&
    (annotation.anchorKind === "span" || annotation.anchorKind === "field");
  if (!canJump) {
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
}: {
  annotation: AnnotationByTrace;
  isOwn: boolean;
}) {
  return (
    <HStack gap={2} align="start">
      <Author annotation={annotation} />
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

function Author({ annotation }: { annotation: AnnotationByTrace }) {
  return (
    <>
      <UserAvatar
        size="xs"
        background="gray.solid"
        color="white"
        name={annotation.user?.name ?? annotation.email ?? "?"}
        image={annotation.user?.image}
      />
      <VStack align="start" gap={0} flex={1} minWidth={0}>
        {annotation.user?.name ? (
          <Text textStyle="xs" fontWeight="600">
            {annotation.user.name}
          </Text>
        ) : (
          <ApiAuthor email={annotation.email} />
        )}
        <Text textStyle="2xs" color="fg.subtle">
          {new Date(annotation.createdAt).toLocaleString()}
        </Text>
      </VStack>
    </>
  );
}

/** The thumb a reviewer gave the turn, and nothing at all when they gave none. */
function ThumbVerdict({
  isThumbsUp,
}: {
  isThumbsUp: AnnotationByTrace["isThumbsUp"];
}) {
  if (isThumbsUp === true) {
    return (
      <Icon
        as={ThumbsUp}
        boxSize={3.5}
        color="green.fg"
        aria-label="Thumbs up"
      />
    );
  }
  if (isThumbsUp === false) {
    return (
      <Icon
        as={ThumbsDown}
        boxSize={3.5}
        color="red.fg"
        aria-label="Thumbs down"
      />
    );
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
function SuggestedCorrection({
  expectedOutput,
}: {
  expectedOutput: string | null;
}) {
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
        wordBreak="break-word"
        maxHeight="160px"
        overflowY="auto"
        // Explicit, so an overflowing unbreakable token clips here instead of
        // computing overflow-x to auto and growing a horizontal scrollbar.
        // The wrap rule above keeps that clip from ever cutting content away:
        // pre-wrap alone does not break whitespace-free tokens.
        overflowX="hidden"
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
  scoreOptions: AnnotationByTrace["scoreOptions"],
  scoreNamesById: Map<string, string>,
): ScoreEntry[] {
  if (!scoreOptions || typeof scoreOptions !== "object") return [];
  return Object.entries(scoreOptions as Record<string, unknown>)
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
  if (!name || !raw || typeof raw !== "object") return null;
  const score = raw as { value?: unknown; reason?: unknown };
  const value = Array.isArray(score.value)
    ? score.value.join(", ")
    : String(score.value ?? "");
  if (!value) return null;
  return { name, value, reason: readReason(score.reason) };
}

function readReason(reason: unknown): string | null {
  if (reason == null || reason === "") return null;
  if (typeof reason === "object") return JSON.stringify(reason);
  return String(reason);
}
