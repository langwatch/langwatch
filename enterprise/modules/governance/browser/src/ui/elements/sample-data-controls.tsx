/** Toggle and banner for governance sample data panels. */

import { Button, Flex, Icon, Text } from "@chakra-ui/react";
import { Compass, Sparkles, Tent } from "lucide-react";
import type React from "react";
import type { ReactNode } from "react";

/** Sample data toggle; stays on screen to show measurements not in production data. */
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
 * Banner shown when samples are active; an `output` (role status) honesty affordance
 * claiming that nothing on screen is real.
 */
export const SampleDataBanner: React.FC<{ children?: ReactNode }> = ({ children }) => (
  <Flex
    as="output"
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
      {/* The default no longer points at the per-panel badges. A page whose
          panels are ALL invented drops those badges, because this banner has
          already said it once and sixteen repetitions of it say nothing more
          — which left the old copy naming marks the reader could not see.
          This wording stands on its own and stays true either way. */}
      {children ??
        "Viewing sample data. Nothing here is real. Turn samples off to see your organization’s data."}
    </Text>
  </Flex>
);
