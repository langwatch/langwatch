import { Button, Flex, Icon, Text } from "@chakra-ui/react";
import { Compass, Sparkles, Tent } from "lucide-react";
import type React from "react";
import type { ReactNode } from "react";

/**
 * The two affordances that come with a governance page's sample panels: the
 * toggle that turns them on and off, and the banner that says what they are.
 *
 * Both are modelled on the trace explorer's sample-data pair
 * (`Toolbar.tsx`, `SampleDataBanner.tsx`) — same words, same orange, same
 * single exit — because a reader who has learned what "sample data" means on
 * one screen should not have to learn it again on another. Every governance
 * page renders the same two, so the lesson carries across the section too.
 *
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */

/**
 * Toggle for the sample panels. Belongs top-right in the page header, beside
 * that page's other actions.
 *
 * Unlike the trace explorer's, this one stays on screen after real data
 * arrives. There it is onboarding furniture: sample traces stand in for real
 * traces, so once real ones exist the button has nothing left to offer and is
 * hidden. Here the sample panels show measurements the platform does not take
 * at all, so an organization with a full screen still has a reason to look at
 * them — they are the only picture of what the screen will hold once those
 * measurements exist.
 */
export const SampleDataToggle: React.FC<{
  active: boolean;
  onToggle: () => void;
  /**
   * Defaults to the size Costs has always rendered. Pages whose header actions
   * are `sm` pass `sm` so the row lines up; nothing else about the button
   * changes with it.
   */
  size?: "xs" | "sm";
}> = ({ active, onToggle, size = "xs" }) => {
  const label = active ? "Hide sample data" : "See sample data";
  return (
    <Button
      size={size}
      variant={active ? "subtle" : "ghost"}
      colorPalette={active ? "orange" : undefined}
      onClick={onToggle}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon boxSize={3.5} color={{ base: "orange.500", _dark: "orange.fg" }}>
        {active ? <Tent /> : <Compass />}
      </Icon>
      {label}
    </Button>
  );
};

/**
 * The honesty affordance, rendered directly under the page header whenever any
 * panel on the screen is invented.
 *
 * Each sample panel already carries its own badge, but a badge is a label on
 * one panel and this is a claim about the screen. The failure it guards
 * against is a reader who arrives at a filled-in dashboard, reads a figure off
 * it, and never looks at the corner of the card it came from — a number in the
 * house typeface reads as measured whether or not it was.
 *
 * `role="status"` rather than an alert: this is a standing condition of the
 * screen, not an event, and it should not interrupt a screen reader mid-
 * sentence to announce it.
 *
 * The copy may be replaced per page — a page whose samples stand in for a read
 * that exists says something different from one whose samples stand in for a
 * measurement we do not take — but it must still say that nothing on screen is
 * real.
 */
export const SampleDataBanner: React.FC<{ children?: ReactNode }> = ({
  children,
}) => (
  <Flex
    role="status"
    align="center"
    gap={2}
    paddingX={3.5}
    paddingY={2.5}
    background="orange.subtle"
    borderWidth="1px"
    borderColor="orange.muted"
    borderRadius="md"
    color="orange.fg"
    flexShrink={0}
  >
    <Icon boxSize={4}>
      <Sparkles />
    </Icon>
    <Text textStyle="sm" fontWeight={600}>
      {children ??
        "Panels marked sample are illustrations of measurements we do not take yet — nothing here is real."}
    </Text>
  </Flex>
);
