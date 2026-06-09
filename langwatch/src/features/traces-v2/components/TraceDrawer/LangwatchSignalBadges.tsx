import { HStack, Icon } from "@chakra-ui/react";
import type { IconType } from "react-icons";
import {
  LuBookOpen,
  LuBot,
  LuClipboardCheck,
  LuMessagesSquare,
  LuSparkles,
  LuTag,
  LuTheater,
  LuUser,
} from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import type { LangwatchSignalBucket } from "~/server/api/routers/tracesV2.schemas";

interface SignalDisplay {
  icon: IconType;
  label: string;
  /**
   * Chakra colorPalette for the icon. Picking per-bucket colours makes
   * the strip scannable — operators can spot "this LLM trace has a
   * scenario" or "this one carries an eval" by the dot colour without
   * reading the tooltip. All flat across light/dark via the
   * `colorPalette.fg` token alias.
   */
  palette: string;
  /** Short label shown beneath / next to the icon when render mode is "labeled". */
  shortLabel: string;
}

/**
 * Per-bucket icon + label + palette. Display order is the order keys
 * are declared here so badges line up consistently across rows.
 */
const SIGNAL_DISPLAY: Record<LangwatchSignalBucket, SignalDisplay> = {
  prompt: {
    icon: LuSparkles,
    label: "Managed prompt",
    shortLabel: "Prompt",
    palette: "purple",
  },
  scenario: {
    icon: LuTheater,
    label: "Scenario run",
    shortLabel: "Scenario",
    palette: "pink",
  },
  evaluation: {
    icon: LuClipboardCheck,
    label: "Evaluation",
    shortLabel: "Eval",
    palette: "green",
  },
  rag: {
    icon: LuBookOpen,
    label: "RAG context",
    shortLabel: "RAG",
    palette: "teal",
  },
  thread: {
    icon: LuMessagesSquare,
    label: "Conversation thread (chat-shaped span)",
    shortLabel: "Chat",
    palette: "blue",
  },
  user: {
    icon: LuUser,
    label: "User ID",
    shortLabel: "User",
    palette: "cyan",
  },
  metadata: {
    icon: LuTag,
    label: "Custom metadata",
    shortLabel: "Meta",
    palette: "orange",
  },
  genai: {
    icon: LuBot,
    label: "Generic AI instrumentation (no conversation thread)",
    shortLabel: "AI",
    palette: "gray",
  },
};

const DISPLAY_ORDER: LangwatchSignalBucket[] = [
  "prompt",
  "scenario",
  "evaluation",
  "rag",
  "thread",
  "user",
  "metadata",
  "genai",
];

export function LangwatchSignalBadges({
  signals,
  size = "xs",
}: {
  signals: readonly LangwatchSignalBucket[];
  size?: "xs" | "sm";
}) {
  if (signals.length === 0) return null;
  const present = new Set(signals);
  const ordered = DISPLAY_ORDER.filter((s) => present.has(s));
  const boxSize = size === "sm" ? 3.5 : 3;

  return (
    <HStack gap={0.5} flexShrink={0}>
      {ordered.map((bucket) => {
        const { icon, label, palette } = SIGNAL_DISPLAY[bucket];
        return (
          <Tooltip
            key={bucket}
            content={label}
            positioning={{ placement: "top" }}
          >
            <Icon
              as={icon}
              boxSize={boxSize}
              colorPalette={palette}
              color="colorPalette.fg"
              aria-label={label}
            />
          </Tooltip>
        );
      })}
    </HStack>
  );
}
