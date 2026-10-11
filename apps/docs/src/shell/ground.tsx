import { Box } from "@langwatch/design-system/primitives";

export function PageGround({ home }: { home: boolean }) {
  return <Box className="docs-ground" data-home={home} pointerEvents="none" aria-hidden="true" />;
}
