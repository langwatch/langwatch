/** Toggle and banner for governance sample data panels. */

import { Banner } from "@langwatch/design-system/banner";
import { Button, Icon } from "@langwatch/design-system/primitives";
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
 * Banner shown when samples are active: a status claiming that nothing on screen is real.
 * The default wording stands on its own whether or not the panels carry their own badges.
 */
export const SampleDataBanner: React.FC<{ children?: ReactNode }> = ({ children }) => (
  <Banner
    status="warning"
    icon={<Sparkles size={16} aria-hidden="true" />}
    title={
      children ??
      "Viewing sample data. Nothing here is real. Turn samples off to see your organization’s data."
    }
  />
);
