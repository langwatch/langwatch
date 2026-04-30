import { Button, Heading, Icon, Text, VStack } from "@chakra-ui/react";
import {
  ArrowRight,
  Compass,
  Filter,
  PanelRightOpen,
  Sparkles,
} from "lucide-react";
import type React from "react";
import type { StageId } from "../chapters/onboardingJourneyConfig";

interface HubOption {
  label: string;
  description: string;
  icon: typeof Sparkles;
  /**
   * Stage to jump into when this option is picked. Aim at the *narrative
   * entry point* rather than the climax — picking the drawer tour lands
   * at `postArrival` so the user clicks the highlighted row themselves
   * and the rest of the drawer beats fall out naturally, exactly like
   * a first-time visit. The hub just chooses which beat to start from;
   * the rest of the journey machinery stays on its single code path.
   */
  target: StageId;
}

const RETURNING_USER_HUB_OPTIONS: HubOption[] = [
  {
    label: "How traces arrive",
    description: "The aurora ribbon and the live-update feel.",
    icon: Sparkles,
    target: "arrivalPrep",
  },
  {
    label: "The trace drawer",
    description: "Conversation, spans, evals — see one in detail.",
    icon: PanelRightOpen,
    target: "postArrival",
  },
  {
    label: "Filters and facets",
    description: "Slice the table by service, model, status, more.",
    icon: Filter,
    target: "facetsReveal",
  },
];

interface ReturningUserHubProps {
  onJump: (stage: StageId) => void;
}

/**
 * Welcome screen for users who've completed the onboarding journey at
 * least once. Instead of making them sit through the linear narrative
 * again, we offer a small hub of "help me with that bit" jumps.
 *
 * `Run me through the whole thing` falls back to `trace_explorer` (the
 * first substantive beat) so we don't repeat the bare welcome line they
 * just saw.
 */
export function ReturningUserHub({
  onJump,
}: ReturningUserHubProps): React.ReactElement {
  return (
    <VStack align="center" gap={4} maxWidth="58ch" textAlign="center">
      <Heading
        fontSize={{ base: "3xl", md: "4xl" }}
        letterSpacing="-0.035em"
        fontWeight={400}
        lineHeight="1.05"
        color="fg"
      >
        Welcome back.
      </Heading>
      <Text color="fg.muted" textStyle="md" lineHeight="1.65" maxWidth="48ch">
        Want a hand with a specific bit? Pick one — or click around the
        table.
      </Text>
      <VStack gap={2} width="full" maxWidth="380px" align="stretch">
        {RETURNING_USER_HUB_OPTIONS.map((opt) => (
          <Button
            key={opt.target}
            onClick={() => onJump(opt.target)}
            variant="outline"
            colorPalette="gray"
            justifyContent="flex-start"
            width="full"
            height="auto"
            paddingY={2.5}
            paddingX={3}
            _hover={{ borderColor: "border.emphasized", bg: "bg.panel" }}
          >
            <Icon boxSize={4} color="orange.fg">
              <opt.icon />
            </Icon>
            <VStack align="start" gap={0} flex={1}>
              <Text textStyle="sm" fontWeight={500} color="fg">
                {opt.label}
              </Text>
              <Text textStyle="xs" color="fg.muted" fontWeight={400}>
                {opt.description}
              </Text>
            </VStack>
            <Icon boxSize={3.5} color="fg.subtle">
              <ArrowRight />
            </Icon>
          </Button>
        ))}
      </VStack>
      <Button
        size="xs"
        variant="ghost"
        colorPalette="gray"
        color="fg.muted"
        onClick={() => onJump("trace_explorer")}
        _hover={{ color: "fg" }}
      >
        <Icon boxSize={3.5}>
          <Compass />
        </Icon>
        Run me through the whole thing
      </Button>
    </VStack>
  );
}
