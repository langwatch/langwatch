import { Box, Image, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { getDisplayRoleVisuals } from "~/features/traces-v2/components/TraceDrawer/scenarioRoles";
import { ToolPairCard } from "~/features/traces-v2/components/TraceDrawer/transcript/ToolBlocks";
import { Bubble } from "~/features/traces-v2/components/TraceTable/registry/addons/conversation/Bubble";
import { MediaPart } from "../simulations/MediaPart";
import type { AudioPlaybackProps } from "../simulations/useSequentialAudioPlayback";
import { RenderInputOutput } from "../traces/RenderInputOutput";
import { ErrorMessage } from "./ErrorMessage";
import { tryParseJson } from "./structuredOutput";
import type { DisplayPart } from "./types";

/**
 * One component per part kind, so the thread's job is choosing between them
 * rather than holding every layout decision in one switch.
 */

export const alignForRole = (role?: string): "flex-start" | "flex-end" =>
  role === "assistant" ? "flex-start" : "flex-end";

const textAlignForRole = (role?: string): "left" | "right" =>
  role === "assistant" ? "left" : "right";

export function TextPart({
  part,
  compact,
  roleMode,
  structuredOutput,
  actions,
}: {
  part: Extract<DisplayPart, { kind: "text" }>;
  compact: boolean;
  roleMode: "chat" | "scenario";
  structuredOutput: boolean;
  actions?: ReactNode;
}) {
  const structured =
    structuredOutput && part.role === "assistant"
      ? tryParseJson(part.content)
      : undefined;

  if (structured) {
    return (
      <VStack align="flex-start" width="100%" gap={1}>
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
        {actions}
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
      {actions}
    </VStack>
  );
}

export function ImagePart({
  part,
}: {
  part: Extract<DisplayPart, { kind: "image" }>;
}) {
  return (
    <VStack
      align={alignForRole(part.role)}
      data-align={alignForRole(part.role)}
    >
      <Image src={part.src} maxH="200px" borderRadius="md" />
    </VStack>
  );
}

export function MediaRow({
  part,
  projectId,
  audioPlayback,
}: {
  part: Extract<DisplayPart, { kind: "media" }>;
  projectId: string;
  audioPlayback?: AudioPlaybackProps;
}) {
  // Players stretch to the container; attachment chips hug the side the message
  // came from, the way a bubble would. Mirrored into `data-media-align` because
  // jsdom cannot read compiled flex styles.
  const innerAlign =
    part.part.type === "binary"
      ? alignForRole(part.role)
      : ("stretch" as const);

  return (
    <VStack
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
          audioPlayback={audioPlayback}
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

export function ToolPart({
  part,
  compact,
}: {
  part: Extract<DisplayPart, { kind: "tool" }>;
  compact: boolean;
}) {
  return (
    <Box width="full" maxW={compact ? "100%" : "85%"}>
      <ToolPairCard
        name={part.name}
        input={part.arguments}
        id={part.toolCallId}
        result={part.result ?? null}
      />
    </Box>
  );
}

export function ErrorPart({
  part,
}: {
  part: Extract<DisplayPart, { kind: "error" }>;
}) {
  return (
    <Box width="100%">
      <ErrorMessage error={part.error} />
    </Box>
  );
}
