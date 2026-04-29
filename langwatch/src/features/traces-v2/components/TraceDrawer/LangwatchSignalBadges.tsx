import { HStack, Icon } from "@chakra-ui/react";
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
import type { IconType } from "react-icons";
import { Tooltip } from "~/components/ui/tooltip";
import type { LangwatchSignalBucket } from "~/server/api/routers/tracesV2.schemas";

interface SignalDisplay {
  icon: IconType;
  label: string;
}

/**
 * Per-bucket icon + label. Display order is the order keys are declared
 * here, so badges line up consistently across rows.
 */
const SIGNAL_DISPLAY: Record<LangwatchSignalBucket, SignalDisplay> = {
  prompt: { icon: LuSparkles, label: "Managed prompt" },
  scenario: { icon: LuTheater, label: "Scenario run" },
  evaluation: { icon: LuClipboardCheck, label: "Evaluation" },
  rag: { icon: LuBookOpen, label: "RAG context" },
  thread: { icon: LuMessagesSquare, label: "Conversation thread" },
  user: { icon: LuUser, label: "User ID" },
  metadata: { icon: LuTag, label: "Custom metadata" },
  genai: { icon: LuBot, label: "GenAI instrumentation" },
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
        const { icon, label } = SIGNAL_DISPLAY[bucket];
        return (
          <Tooltip
            key={bucket}
            content={label}
            positioning={{ placement: "top" }}
          >
            <Icon
              as={icon}
              boxSize={boxSize}
              color="purple.fg"
              aria-label={label}
            />
          </Tooltip>
        );
      })}
    </HStack>
  );
}
