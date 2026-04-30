import {
  Avatar,
  Box,
  Flex,
  HStack,
  Icon,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Edit3, Lightbulb, MessageSquare } from "lucide-react";
import { useMemo, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";

type AnnotationByTraceIds =
  RouterOutputs["annotation"]["getByTraceIds"][number];
import type { ParsedTurn } from "./types";
import { AnnotationPopover } from "./AnnotationPopover";

interface AnnotationsViewProps {
  parsedTurns: ParsedTurn[];
  currentTraceId: string;
}

/**
 * "All annotations" rollup for the active conversation. Lives inside the
 * Conversation view (not as a top-level drawer tab) — annotations are
 * conversation-shaped, not trace-shaped, so this surface belongs here.
 *
 * Click any entry to edit it in the same `AnnotationPopover` used inline.
 */
export function AnnotationsView({
  parsedTurns,
  currentTraceId,
}: AnnotationsViewProps) {
  const { project, hasPermission } = useOrganizationTeamProject();

  const traceIds = useMemo(
    () => parsedTurns.map((p) => p.turn.traceId),
    [parsedTurns],
  );

  const annotations = api.annotation.getByTraceIds.useQuery(
    { projectId: project?.id ?? "", traceIds },
    {
      enabled:
        !!project?.id && traceIds.length > 0 && hasPermission("annotations:view"),
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  );

  // Group annotations by trace so each turn's notes cluster together.
  const grouped = useMemo(() => {
    const out = new Map<string, NonNullable<typeof annotations.data>>();
    for (const a of annotations.data ?? []) {
      if (!out.has(a.traceId)) out.set(a.traceId, []);
      out.get(a.traceId)!.push(a);
    }
    return out;
  }, [annotations.data]);

  if (annotations.isLoading) {
    return (
      <Flex align="center" justify="center" padding={8}>
        <Text textStyle="xs" color="fg.subtle">
          Loading annotations…
        </Text>
      </Flex>
    );
  }

  const total = annotations.data?.length ?? 0;
  if (total === 0) return <EmptyState />;

  return (
    <VStack
      align="stretch"
      gap={4}
      paddingX={5}
      paddingY={4}
      overflow="auto"
      flex={1}
    >
      {parsedTurns.map((p, i) => {
        const items = grouped.get(p.turn.traceId);
        if (!items || items.length === 0) return null;
        const isCurrent = p.turn.traceId === currentTraceId;
        return (
          <VStack key={p.turn.traceId} align="stretch" gap={2}>
            <HStack gap={2}>
              <Text
                textStyle="2xs"
                fontWeight="600"
                color={isCurrent ? "blue.fg" : "fg.muted"}
                textTransform="uppercase"
                letterSpacing="0.06em"
              >
                Turn {i + 1}
                {isCurrent ? " · current" : ""}
              </Text>
              <Box
                height="1px"
                flex={1}
                bg={isCurrent ? "blue.solid" : "border.muted"}
              />
              <Text textStyle="2xs" color="fg.subtle">
                {items.length} {items.length === 1 ? "note" : "notes"}
              </Text>
            </HStack>
            <VStack align="stretch" gap={2}>
              {items.map((annotation) => (
                <AnnotationRow
                  key={annotation.id}
                  traceId={p.turn.traceId}
                  output={p.turn.output}
                  annotation={annotation}
                />
              ))}
            </VStack>
          </VStack>
        );
      })}
    </VStack>
  );
}

function AnnotationRow({
  traceId,
  output,
  annotation,
}: {
  traceId: string;
  output?: string | null;
  annotation: AnnotationByTraceIds;
}) {
  const [open, setOpen] = useState(false);
  const { hasPermission } = useOrganizationTeamProject();
  const canEdit = hasPermission("annotations:manage");
  const mode: "annotate" | "suggest" = annotation.expectedOutput
    ? "suggest"
    : "annotate";

  const trigger = (
    <Box
      role={canEdit ? "button" : undefined}
      tabIndex={canEdit ? 0 : undefined}
      onClick={(e) => {
        if (!canEdit) return;
        e.stopPropagation();
        setOpen(true);
      }}
      cursor={canEdit ? "pointer" : "default"}
      borderRadius="md"
      borderWidth="1px"
      borderColor="border.muted"
      bg="bg.subtle"
      paddingX={3}
      paddingY={2.5}
      _hover={canEdit ? { bg: "bg.muted" } : undefined}
      transition="background 0.12s ease"
    >
      <VStack align="stretch" gap={2}>
        <HStack>
          <Avatar.Root size="xs" background="gray.solid" color="white">
            <Avatar.Fallback
              name={annotation.user?.name ?? annotation.email ?? "?"}
            />
          </Avatar.Root>
          <Text textStyle="xs" fontWeight="600">
            {annotation.user?.name ?? annotation.email ?? "anonymous"}
          </Text>
          <Spacer />
          {annotation.expectedOutput ? (
            <HStack gap={1}>
              <Icon as={Lightbulb} boxSize={3} color="yellow.fg" />
              <Text textStyle="2xs" color="fg.muted">
                correction
              </Text>
            </HStack>
          ) : (
            <HStack gap={1}>
              <Icon as={MessageSquare} boxSize={3} color="fg.muted" />
              <Text textStyle="2xs" color="fg.muted">
                annotation
              </Text>
            </HStack>
          )}
          <Text textStyle="2xs" color="fg.subtle">
            {new Date(annotation.createdAt).toLocaleString()}
          </Text>
        </HStack>
        {annotation.comment && (
          <Text textStyle="sm" whiteSpace="pre-wrap">
            {annotation.comment}
          </Text>
        )}
        {annotation.expectedOutput && (
          <Box
            borderRadius="sm"
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border.muted"
            paddingX={2}
            paddingY={1.5}
            fontFamily="mono"
            fontSize="xs"
            whiteSpace="pre-wrap"
            maxHeight="160px"
            overflowY="auto"
          >
            {annotation.expectedOutput}
          </Box>
        )}
      </VStack>
    </Box>
  );

  if (!canEdit) return trigger;

  return (
    <AnnotationPopover
      traceId={traceId}
      output={output}
      mode={mode}
      annotationId={annotation.id}
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
    />
  );
}

function EmptyState() {
  return (
    <Flex align="center" justify="center" padding={8} direction="column" gap={2}>
      <Icon as={Edit3} boxSize={5} color="fg.subtle" />
      <Text textStyle="sm" color="fg.muted" fontWeight="600">
        No annotations yet
      </Text>
      <Text textStyle="xs" color="fg.subtle" textAlign="center" maxWidth="320px">
        Switch back to the bubbles view and use Annotate or Suggest on any
        turn — they&apos;ll show up here.
      </Text>
    </Flex>
  );
}
