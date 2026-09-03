import type { NextSpeaker } from "../elements/next-speaker";
import { TypingBubble } from "../elements/typing-bubble";
import { Box, HStack, Image, Text, VStack } from "@chakra-ui/react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { Settings } from "react-feather";
import type { SimulationMessage } from "@langwatch/scenario-contract";
import type { MediaPartData } from "../../model/media-parts";
import { MediaPart } from "./media-part";
import type { AudioPlaybackProps } from "../../behavior/use-sequential-audio-playback";
import { useSequentialAudioPlayback } from "../../behavior/use-sequential-audio-playback";
import {
  flattenMessages,
  groupIntoTurns,
  type DisplayItem,
  type StreamingMessage,
} from "../../model/scenario-message-display";

export type { StreamingMessage } from "../../model/scenario-message-display";

// Role → alignment mapping. Extracted here so `align` and `data-align` always
// derive from the same value — the `data-align` attribute mirrors `align` for
// jsdom tests, which cannot read Chakra's atomic CSS classes via getComputedStyle.
const alignForRole = (role?: string): "flex-start" | "flex-end" =>
  role === "assistant" ? "flex-start" : "flex-end";

const textAlignForRole = (role?: string): "left" | "right" =>
  role === "assistant" ? "left" : "right";

export interface ScenarioRoleVisuals {
  displayRole: "user" | "assistant";
  bubbleLabel: string;
  Icon: () => ReactNode;
}

export interface ScenarioBubbleProps {
  side: "left" | "right";
  tone: "user" | "assistant";
  label: string;
  icon: ReactNode;
  text: string;
  size: "compact" | "regular";
  maxChars: number;
}

export interface ScenarioMessageRendererProps {
  messages: SimulationMessage[];
  streamingMessages?: StreamingMessage[];
  variant: "grid" | "drawer";
  /** Project that owns the stored objects in this message thread. Forwarded to MediaPart for server-side probes. */
  projectId: string;
  /** Whose message the run is waiting for, drawn as dots under the thread. */
  typingRole?: NextSpeaker;
  renderBubble: (props: ScenarioBubbleProps) => ReactNode;
  renderInputOutput: (value: unknown) => ReactNode;
  getRoleVisuals: (role: "user" | "assistant") => ScenarioRoleVisuals;
  renderTurnSeparator: (props: { index: number; traceId: string }) => ReactNode;
  renderMediaPart?: (props: {
    part: MediaPartData;
    projectId: string;
    audioPlayback?: AudioPlaybackProps;
  }) => ReactNode;
}

export function ScenarioMessageRenderer({
  messages,
  streamingMessages,
  variant,
  projectId,
  typingRole,
  renderBubble,
  renderInputOutput,
  getRoleVisuals,
  renderTurnSeparator,
  renderMediaPart,
}: ScenarioMessageRendererProps) {
  const smallerView = variant === "grid";
  const endRef = useRef<HTMLDivElement>(null);

  const items = useMemo(
    () => flattenMessages(messages, streamingMessages),
    [messages, streamingMessages],
  );

  // Drawer variant groups consecutive items that share a trace into turns,
  // each headed by a Traces V2-style separator line that opens the trace.
  const turns = useMemo(() => groupIntoTurns(items), [items]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items, typingRole]);

  // Ordered list of audio-only item ids — the single source of ordering truth
  // for the sequential playback hook. Filters to audio media only (not video /
  // binary) so the hook's "next" index is never off by a non-audio item.
  const orderedAudioIds = useMemo(
    () =>
      items
        .filter(
          (item): item is Extract<DisplayItem, { kind: "media" }> =>
            item.kind === "media" && item.part.type === "audio",
        )
        .map((item) => item.id),
    [items],
  );

  // Per-renderer-instance sequential audio playback coordinator.
  // Each instance of ScenarioMessageRenderer owns its own hook invocation,
  // so grid cells are fully isolated from one another.
  const { getAudioProps } = useSequentialAudioPlayback({
    orderedIds: orderedAudioIds,
  });

  const renderItem = (item: DisplayItem) => {
    switch (item.kind) {
      case "text": {
        // Scenario role mapping shared with the Traces V2 drawer: the
        // agent under test renders as the conversation's "user" side
        // (left/blue), the simulated user as the "assistant" side
        // (right/purple, flask icon).
        const visuals = getRoleVisuals(item.role === "assistant" ? "assistant" : "user");
        const RoleIcon = visuals.Icon;
        return (
          <VStack
            key={item.id}
            align={alignForRole(item.role)}
            data-align={alignForRole(item.role)}
            gap={1}
            width="100%"
          >
            {renderBubble({
              side: visuals.displayRole === "user" ? "left" : "right",
              tone: visuals.displayRole,
              label: visuals.bubbleLabel,
              icon: <RoleIcon />,
              text: item.content,
              size: smallerView ? "compact" : "regular",
              maxChars: smallerView ? 320 : 800,
            })}
          </VStack>
        );
      }

      case "image":
        return (
          <VStack
            key={item.id}
            align={alignForRole(item.role)}
            data-align={alignForRole(item.role)}
          >
            <Image src={item.src} maxH="200px" borderRadius="md" />
          </VStack>
        );

      case "media": {
        // Audio/video players stretch to the container width; attachment
        // chips hug the message side like a bubble would (user sent it →
        // right, agent → left). Mirrored into data-media-align because
        // jsdom cannot read the compiled flex styles.
        const innerAlign =
          item.part.type === "binary" ? alignForRole(item.role) : ("stretch" as const);
        return (
          <VStack
            key={item.id}
            align={alignForRole(item.role)}
            data-align={alignForRole(item.role)}
            width="100%"
          >
            <VStack
              align={innerAlign}
              data-media-align={innerAlign}
              gap={1}
              width={{ base: "100%", md: "min(420px, 95%)" }}
            >
              {renderMediaPart ? (
                renderMediaPart({
                  part: item.part,
                  projectId,
                  audioPlayback: item.part.type === "audio" ? getAudioProps(item.id) : undefined,
                })
              ) : (
                <MediaPart
                  part={item.part}
                  projectId={projectId}
                  audioPlayback={item.part.type === "audio" ? getAudioProps(item.id) : undefined}
                />
              )}
              {item.transcript && (
                <Text
                  fontSize="xs"
                  color="fg.muted"
                  fontStyle="italic"
                  paddingX={2}
                  textAlign={textAlignForRole(item.role)}
                >
                  {item.transcript}
                </Text>
              )}
            </VStack>
          </VStack>
        );
      }

      case "tool_call":
        return (
          <VStack key={item.id} align="flex-start" gap={1.5} width="100%">
            <HStack gap={1.5} color="orange.fg">
              <Settings size={12} />
              <Text
                textStyle="2xs"
                fontWeight="600"
                textTransform="uppercase"
                letterSpacing="0.06em"
              >
                {item.name}
              </Text>
            </HStack>
            <Box
              w="full"
              maxW="85%"
              bg="bg.muted/60"
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="lg"
              padding={3}
            >
              {renderInputOutput(item.arguments)}
            </Box>
          </VStack>
        );

      case "tool_result":
        return (
          <VStack key={item.id} align="flex-start" gap={1.5} width="100%">
            <HStack gap={1.5} color="fg.muted">
              <Settings size={12} />
              <Text
                textStyle="2xs"
                fontWeight="600"
                textTransform="uppercase"
                letterSpacing="0.06em"
              >
                Tool result
              </Text>
            </HStack>
            <Box
              w="full"
              maxW="85%"
              bg="bg.muted/60"
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="lg"
              padding={3}
            >
              {renderInputOutput(item.result)}
            </Box>
          </VStack>
        );

      default:
        return null;
    }
  };

  return (
    <VStack
      align="stretch"
      gap={smallerView ? 2 : 4}
      // Drawer variant: the section content already pads — avoid doubling.
      padding={smallerView ? 2 : 0}
      fontSize={smallerView ? "xs" : "sm"}
      width="100%"
      height="100%"
      overflowY="auto"
    >
      {smallerView
        ? items.map(renderItem)
        : turns.map((turn) => (
            <VStack key={turn.key} align="stretch" gap={4} width="100%">
              {turn.traceId &&
                turn.turnNumber != null &&
                renderTurnSeparator({ index: turn.turnNumber, traceId: turn.traceId })}
              {turn.items.map(renderItem)}
            </VStack>
          ))}
      {typingRole ? (
        <TypingBubble role={typingRole} size={smallerView ? "compact" : "regular"} />
      ) : null}
      <div ref={endRef} />
    </VStack>
  );
}
