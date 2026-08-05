import { Box, HStack, Icon, Spacer, Text, VStack } from "@chakra-ui/react";
import {
  Lightbulb,
  MessageCircle,
  Pencil,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { UserAvatar } from "~/components/UserAvatar";
import { Tooltip } from "~/components/ui/tooltip";
import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";

interface ScoreEntry {
  name: string;
  value: string;
  reason: string | null;
}

interface AnnotationCardProps {
  annotation: AnnotationByTrace;
  /** Score key names by id, so a card never falls back to a raw id. */
  scoreNamesById: Map<string, string>;
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
  isOwn,
  onEdit,
}: AnnotationCardProps) {
  const scores = resolveScores(annotation.scoreOptions, scoreNamesById);
  const hasCorrection = !!annotation.expectedOutput;

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
        <HStack gap={2} align="start">
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
          <Spacer />
          {annotation.isThumbsUp === true && (
            <Icon
              as={ThumbsUp}
              boxSize={3.5}
              color="green.fg"
              aria-label="Thumbs up"
            />
          )}
          {annotation.isThumbsUp === false && (
            <Icon
              as={ThumbsDown}
              boxSize={3.5}
              color="red.fg"
              aria-label="Thumbs down"
            />
          )}
          {isOwn && (
            <Tooltip
              content="Edit annotation"
              positioning={{ placement: "top" }}
            >
              <Icon as={Pencil} boxSize={3} color="fg.muted" />
            </Tooltip>
          )}
        </HStack>

        {annotation.comment && (
          <Text textStyle="xs" whiteSpace="pre-wrap">
            {annotation.comment}
          </Text>
        )}

        {scores.length > 0 && (
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
        )}

        {hasCorrection && (
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
              {annotation.expectedOutput}
            </Box>
          </VStack>
        )}
      </VStack>
    </Box>
  );
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
  const entries: ScoreEntry[] = [];
  for (const [id, raw] of Object.entries(
    scoreOptions as Record<string, unknown>,
  )) {
    const name = scoreNamesById.get(id);
    if (!name || !raw || typeof raw !== "object") continue;
    const score = raw as { value?: unknown; reason?: unknown };
    const value = Array.isArray(score.value)
      ? score.value.join(", ")
      : String(score.value ?? "");
    if (!value) continue;
    entries.push({ name, value, reason: readReason(score.reason) });
  }
  return entries;
}

function readReason(reason: unknown): string | null {
  if (reason == null || reason === "") return null;
  if (typeof reason === "object") return JSON.stringify(reason);
  return String(reason);
}
