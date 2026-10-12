// CLI authorize flow state message, drawn as the design system's inline banner. Role is the
// banner's: an error interrupts a screen reader, the rest are polite.

import { Banner, type BannerStatus } from "@langwatch/design-system/banner";
import type React from "react";

const STATUS: Record<"green" | "red" | "orange" | "blue", BannerStatus> = {
  green: "success",
  red: "error",
  orange: "warning",
  blue: "info",
};

export function StatusCard({
  palette,
  icon: Glyph,
  title,
  children,
}: {
  palette: "green" | "red" | "orange" | "blue";
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Banner status={STATUS[palette]} title={title} icon={<Glyph size={16} aria-hidden="true" />}>
      {children}
    </Banner>
  );
}
