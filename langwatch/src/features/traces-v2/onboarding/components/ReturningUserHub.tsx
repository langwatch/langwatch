import { Button, HStack, Heading, Icon, Text, VStack } from "@chakra-ui/react";
import { Filter, PanelRightOpen, Sparkles } from "lucide-react";
import type React from "react";
import type { StageId } from "../chapters/onboardingJourneyConfig";

interface HubOption {
  label: string;
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
    icon: Sparkles,
    target: "arrivalPrep",
  },
  {
    label: "The trace drawer",
    icon: PanelRightOpen,
    target: "postArrival",
  },
  {
    label: "Filters and facets",
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
 * Three cards in a single row, icon + label only — descriptions and
 * arrow chrome were noise once the user already knows the product.
 */
export function ReturningUserHub({
  onJump,
}: ReturningUserHubProps): React.ReactElement {
  return (
    <VStack align="center" gap={5} maxWidth="58ch" textAlign="center">
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
        Want a hand with a specific bit? Pick one — or click around the table.
      </Text>
      <HStack gap={2} width="full" align="stretch" justify="center">
        {RETURNING_USER_HUB_OPTIONS.map((opt) => (
          <Button
            key={opt.target}
            onClick={() => onJump(opt.target)}
            variant="outline"
            colorPalette="gray"
            flex={1}
            maxWidth="180px"
            height="auto"
            paddingY={3}
            paddingX={3}
            flexDirection="column"
            gap={2}
            _hover={{ borderColor: "border.emphasized", bg: "bg.panel" }}
          >
            <Icon boxSize={4} color="orange.fg">
              <opt.icon />
            </Icon>
            <Text textStyle="sm" fontWeight={500} color="fg">
              {opt.label}
            </Text>
          </Button>
        ))}
      </HStack>
    </VStack>
  );
}
