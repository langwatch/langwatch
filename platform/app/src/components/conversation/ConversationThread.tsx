import { Box, HStack, Image, Text, VStack } from "@chakra-ui/react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { getDisplayRoleVisuals } from "~/features/traces-v2/components/TraceDrawer/scenarioRoles";
import { ToolPairCard } from "~/features/traces-v2/components/TraceDrawer/transcript/ToolBlocks";
import { Bubble } from "~/features/traces-v2/components/TraceTable/registry/addons/conversation/Bubble";
import { MediaPart } from "../simulations/MediaPart";
import { useSequentialAudioPlayback } from "../simulations/useSequentialAudioPlayback";
import { RenderInputOutput } from "../traces/RenderInputOutput";
import { ErrorMessage } from "./ErrorMessage";
import { groupIntoTurns } from "./flattenMessages";
import { tryParseJson } from "./structuredOutput";
import { TurnSeparator } from "./TurnSeparator";
import type { DisplayPart } from "./types";

/**
 * ConversationThread — renders flattened conversation parts.
 *
 * The single renderer behind the prompt playground and the simulations grid
 * and drawer. Everything it draws already existed somewhere in the product:
 * `Bubble` from the Traces V2 conversation view, `ToolPairCard` from its
 * transcript, `MediaPart` from simulations. What was missing was one place
 * that put them together, which is why the playground rendered no tool calls
 * at all and simulations drew a different tool card from the trace drawer.
 */

/**
 * `compact` is the simulations grid cell — smaller type, tighter truncation,
 * no turn separators, since a card is a preview rather than a transcript.
 */
export type ConversationVariant = "compact" | "regular";

interface ConversationThreadProps {
  parts: DisplayPart[];
  variant?: ConversationVariant;
  /**
   * Scenario runs invert the roles a reader expects: the `user` messages come
   * from a simulated user and the `assistant` messages from the agent under
   * test. `scenario` swaps the sides so the agent reads as the subject.
   */
  roleMode?: "chat" | "scenario";
  /** Owns the stored objects behind any media parts. */
  projectId: string;
  /** Rendered after each part, keyed by part id — hover actions, delete. */
  renderPartActions?: (part: DisplayPart) => ReactNode;
  /** Scrolls the newest part into view as content arrives. */
  autoScroll?: boolean;
  /**
   * Renders an assistant reply that parses as a JSON object as a value tree
   * rather than as markdown. On for surfaces whose prompts declare structured
   * outputs; off elsewhere, where a JSON-shaped reply is still prose the user
   * wrote and should read as they wrote it.
   */
  structuredOutput?: boolean;
}

const alignForRole = (role?: string): "flex-start" | "flex-end" =>
  role === "assistant" ? "flex-start" : "flex-end";

const textAlignForRole = (role?: string): "left" | "right" =>
  role === "assistant" ? "left" : "right";

export function ConversationThread({
  parts,
  variant = "regular",
  roleMode = "chat",
  projectId,
  renderPartActions,
  autoScroll = true,
  structuredOutput = false,
}: ConversationThreadProps) {
  const compact = variant === "compact";
  const endRef = useRef<HTMLDivElement>(null);

  const turns = useMemo(() => groupIntoTurns(parts), [parts]);

  useEffect(() => {
    if (!autoScroll) return;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [parts, autoScroll]);

  // Ordered audio ids drive sequential playback: one clip finishing starts the
  // next. Filtered to audio so a sibling video or attachment cannot offset the
  // hook's idea of "next".
  const orderedAudioIds = useMemo(
    () =>
      parts
        .filter(
          (part): part is Extract<DisplayPart, { kind: "media" }> =>
            part.kind === "media" && part.part.type === "audio",
        )
        .map((part) => part.id),
    [parts],
  );

  const { getAudioProps } = useSequentialAudioPlayback({
    orderedIds: orderedAudioIds,
  });

  const renderPart = (part: DisplayPart) => {
    switch (part.kind) {
      case "text": {
        const structured =
          structuredOutput && part.role === "assistant"
            ? tryParseJson(part.content)
            : undefined;
        if (structured) {
          return (
            <VStack key={part.id} align="flex-start" width="100%" gap={1}>
              <Box
                as="pre"
                borderRadius="6px"
                padding={4}
                borderWidth="1px"
                borderColor="border.emphasized"
                width="full"
                whiteSpace="pre-wrap"
              >
                <RenderInputOutput value={structured} showTools />
              </Box>
              {renderPartActions?.(part)}
            </VStack>
          );
        }

        const visuals = getDisplayRoleVisuals(
          part.role === "assistant" ? "assistant" : "user",
          { isScenario: roleMode === "scenario" },
        );
        const RoleIcon = visuals.Icon;
        return (
          <VStack
            key={part.id}
            align={alignForRole(part.role)}
            data-align={alignForRole(part.role)}
            gap={1}
            width="100%"
          >
            <Bubble
              side={visuals.displayRole === "user" ? "left" : "right"}
              tone={visuals.displayRole}
              label={visuals.bubbleLabel}
              icon={<RoleIcon />}
              text={part.content}
              reasoning={part.reasoning}
              size={compact ? "compact" : "regular"}
              maxChars={compact ? 320 : 800}
            />
            {renderPartActions?.(part)}
          </VStack>
        );
      }

      case "image":
        return (
          <VStack
            key={part.id}
            align={alignForRole(part.role)}
            data-align={alignForRole(part.role)}
          >
            <Image src={part.src} maxH="200px" borderRadius="md" />
          </VStack>
        );

      case "media": {
        // Players stretch to the container; attachment chips hug the side the
        // message came from, the way a bubble would. Mirrored into
        // `data-media-align` because jsdom cannot read compiled flex styles.
        const innerAlign =
          part.part.type === "binary"
            ? alignForRole(part.role)
            : ("stretch" as const);
        return (
          <VStack
            key={part.id}
            align={alignForRole(part.role)}
            data-align={alignForRole(part.role)}
            width="100%"
          >
            <VStack
              align={innerAlign}
              data-media-align={innerAlign}
              gap={1}
              width={{ base: "100%", md: "min(420px, 95%)" }}
            >
              <MediaPart
                part={part.part}
                projectId={projectId}
                audioPlayback={
                  part.part.type === "audio"
                    ? getAudioProps(part.id)
                    : undefined
                }
              />
              {part.transcript && (
                <Text
                  fontSize="xs"
                  color="fg.muted"
                  fontStyle="italic"
                  paddingX={2}
                  textAlign={textAlignForRole(part.role)}
                >
                  {part.transcript}
                </Text>
              )}
            </VStack>
          </VStack>
        );
      }

      case "tool":
        return (
          <HStack key={part.id} align="flex-start" width="100%">
            <Box width="full" maxW={compact ? "100%" : "85%"}>
              <ToolPairCard
                name={part.name}
                input={part.arguments}
                id={part.toolCallId}
                result={part.result ?? null}
              />
            </Box>
          </HStack>
        );

      case "error":
        return (
          <Box key={part.id} width="100%">
            <ErrorMessage error={part.error} />
          </Box>
        );

      default:
        return null;
    }
  };

  return (
    <VStack
      align="stretch"
      gap={compact ? 2 : 4}
      // The drawer's section already pads; the grid cell does not.
      padding={compact ? 2 : 0}
      fontSize={compact ? "xs" : "sm"}
      width="100%"
      height="100%"
      overflowY="auto"
    >
      {compact
        ? parts.map(renderPart)
        : turns.map((turn) => (
            <VStack key={turn.key} align="stretch" gap={4} width="100%">
              {turn.traceId && turn.turnNumber != null && (
                <TurnSeparator index={turn.turnNumber} traceId={turn.traceId} />
              )}
              {turn.parts.map(renderPart)}
            </VStack>
          ))}
      <div ref={endRef} />
    </VStack>
  );
}
