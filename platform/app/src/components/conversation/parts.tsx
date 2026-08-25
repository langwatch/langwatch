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

/**
 * Which side of the thread a role's content sits on.
 *
 * Derived from the DISPLAY role, not the wire role, for two reasons. A scenario
 * run swaps the sides (`roleMode`), so the wire role alone points at the wrong
 * edge there. And `Bubble` already picks its side from the display role — when
 * this disagreed with it, a message's own hover actions landed against the
 * opposite edge of the thread from the bubble they belong to.
 */
export function alignForRole({
  role,
  roleMode = "chat",
}: {
  role?: string;
  roleMode?: "chat" | "scenario";
}): "flex-start" | "flex-end" {
  const { displayRole } = getDisplayRoleVisuals(
    role === "assistant" ? "assistant" : "user",
    { isScenario: roleMode === "scenario" },
  );
  return displayRole === "user" ? "flex-start" : "flex-end";
}

const textAlignForRole = ({
  role,
  roleMode = "chat",
}: {
  role?: string;
  roleMode?: "chat" | "scenario";
}): "left" | "right" =>
  alignForRole({ role, roleMode }) === "flex-start" ? "left" : "right";

export function TextPart({
  part,
  compact,
  roleMode,
  labels,
  shouldRenderStructuredOutput,
  actions,
}: {
  part: Extract<DisplayPart, { kind: "text" }>;
  compact: boolean;
  roleMode: "chat" | "scenario";
  labels?: { user?: string; assistant?: string };
  shouldRenderStructuredOutput: boolean;
  actions?: ReactNode;
}) {
  const structured =
    shouldRenderStructuredOutput && part.role === "assistant"
      ? tryParseJson(part.content)
      : undefined;

  const align = alignForRole({ role: part.role, roleMode });

  if (structured) {
    return (
      <VStack align={align} width="100%" gap={1}>
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
        {actions && (
          <PartActionsRow align={align} compact={compact}>
            {actions}
          </PartActionsRow>
        )}
      </VStack>
    );
  }

  const sourceRole = part.role === "assistant" ? "assistant" : "user";
  const visuals = getDisplayRoleVisuals(sourceRole, {
    isScenario: roleMode === "scenario",
  });
  const RoleIcon = visuals.Icon;
  // Keyed by the role the message was sent with rather than the side it is
  // drawn on, so a caller names the speakers it knows about without having to
  // know which edge of the thread `roleMode` will put them against.
  const label = labels?.[sourceRole] ?? visuals.bubbleLabel;

  return (
    <VStack
      align={align}
      data-align={align}
      gap={0}
      width="100%"
      className="group"
      role="group"
    >
      <Bubble
        side={visuals.displayRole === "user" ? "left" : "right"}
        tone={visuals.displayRole}
        label={label}
        icon={<RoleIcon />}
        text={part.content}
        reasoning={part.reasoning}
        size={compact ? "compact" : "regular"}
        maxChars={compact ? 320 : 800}
      />
      {actions && (
        <PartActionsRow align={align} compact={compact}>
          {actions}
        </PartActionsRow>
      )}
    </VStack>
  );
}

const AVATAR_COLUMN = { regular: "34px", compact: "30px" } as const;

function PartActionsRow({
  align,
  compact = false,
  children,
}: {
  align: "flex-start" | "flex-end";
  compact?: boolean;
  children: ReactNode;
}) {
  const inset = AVATAR_COLUMN[compact ? "compact" : "regular"];
  return (
    <Box
      paddingTop={1}
      paddingStart={align === "flex-start" ? inset : 0}
      paddingEnd={align === "flex-end" ? inset : 0}
    >
      {children}
    </Box>
  );
}

export function ImagePart({
  part,
  roleMode = "chat",
}: {
  part: Extract<DisplayPart, { kind: "image" }>;
  roleMode?: "chat" | "scenario";
}) {
  const align = alignForRole({ role: part.role, roleMode });
  return (
    <VStack align={align} data-align={align}>
      {/* Chakra's Image emits a bare <img>, and one with no alt is announced
          as its URL. The conversation does not carry a caption for these, so
          the role it arrived under is the most a screen reader can be told. */}
      <Image
        src={part.src}
        alt={part.role ? `Image from ${part.role}` : "Image in conversation"}
        maxH="200px"
        borderRadius="md"
      />
    </VStack>
  );
}

export function MediaRow({
  part,
  projectId,
  audioPlayback,
  roleMode = "chat",
}: {
  part: Extract<DisplayPart, { kind: "media" }>;
  projectId: string;
  audioPlayback?: AudioPlaybackProps;
  roleMode?: "chat" | "scenario";
}) {
  const align = alignForRole({ role: part.role, roleMode });
  // Players stretch to the container; attachment chips hug the side the message
  // came from, the way a bubble would. Mirrored into `data-media-align` because
  // jsdom cannot read compiled flex styles.
  const innerAlign = part.part.type === "binary" ? align : ("stretch" as const);

  return (
    <VStack align={align} data-align={align} width="100%">
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
            textAlign={textAlignForRole({ role: part.role, roleMode })}
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
