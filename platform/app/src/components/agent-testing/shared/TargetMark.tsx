/**
 * The mark of a target: the kind of agent behind it, in a square small enough
 * to sit in front of a name on one line.
 *
 * It is the icon the agents page draws for the same agent, so a target reads
 * as the agent a person knows from that page. A row that stands for several
 * targets at once carries the target mark instead, because no one kind is
 * behind it.
 *
 * The square takes the colour of the target only in a comparison, where the
 * colour is what tells one column, one bar and one line from another. A run
 * against one target has nothing to tell apart, and a coloured mark there
 * reads as a state the target is in.
 *
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { Box } from "@chakra-ui/react";
import {
  Bot,
  Code,
  Globe,
  type LucideIcon,
  MessageSquare,
  Target,
  Workflow,
} from "lucide-react";

/** What is behind a target, as far as the mark is concerned. */
export type TargetKind =
  | "signature"
  | "prompt"
  | "code"
  | "http"
  | "workflow"
  | "connected"
  /** More than one target under one row, such as a plan that compares two. */
  | "several"
  /** A target the page holds nothing about, such as a run from code. */
  | "unknown";

const KIND_ICONS: Record<TargetKind, LucideIcon> = {
  signature: MessageSquare,
  prompt: MessageSquare,
  code: Code,
  http: Globe,
  workflow: Workflow,
  connected: Bot,
  several: Target,
  unknown: Bot,
};

/** The tint of the square behind a coloured mark, as a hex alpha. */
const TINT_ALPHA = "26";

export function TargetMark({
  kind,
  color,
  testId = "target-mark",
}: {
  kind: TargetKind;
  /** The colour of the target in a comparison; nothing outside one. */
  color?: string;
  testId?: string;
}) {
  const Icon = KIND_ICONS[kind] ?? Bot;
  return (
    <Box
      boxSize="13px"
      borderRadius="3px"
      flexShrink={0}
      display="flex"
      alignItems="center"
      justifyContent="center"
      backgroundColor={color ? `${color}${TINT_ALPHA}` : "bg.muted"}
      data-testid={testId}
      data-kind={kind}
      data-color={color}
    >
      <Icon
        size={9}
        strokeWidth={2.25}
        color={color ?? "var(--chakra-colors-fg-muted)"}
        aria-hidden
      />
    </Box>
  );
}
