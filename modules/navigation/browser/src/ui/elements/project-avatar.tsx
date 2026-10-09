import { Avatar } from "@langwatch/design-system/avatar";
import { firstGrapheme } from "@langwatch/design-system/first-grapheme";
import { Box } from "@langwatch/design-system/primitives";
import { getColorForString } from "@langwatch/design-system/rotating-colors";

/**
 * Project avatar: first grapheme (not char(0), which cuts emoji) on color hashed from grapheme.
 * Moved from platform/app, simplified (no image/silhouette fallbacks).
 */
export const ProjectAvatar = ({
  name,
  size = "2xs",
}: {
  name: string;
  size?: "2xs" | "xs" | "sm";
}) => {
  const initial = firstGrapheme(name);
  return (
    <Avatar.Root
      size={size}
      color="white"
      background={getColorForString("colors", initial).color}
      width={size === "2xs" ? "20px" : undefined}
      height={size === "2xs" ? "20px" : undefined}
    >
      <Avatar.Fallback>{initial}</Avatar.Fallback>
    </Avatar.Root>
  );
};

/** Diameter of the default ("2xs") bubble, the back bubble's offset, and the ring cut between them. */
const BUBBLE_PX = 20;
const STACK_OFFSET_PX = 7;
const RING_PX = 1.5;

/**
 * An aggregate project's bubble (ADR-177): its own bubble before a fainter one,
 * like an avatar group. The back bubble overhangs left so the label stays put;
 * the ring is a masked cut-out, right on any surface. specs/governance/aggregate-project.feature
 */
export const AggregateProjectAvatar = ({ name }: { name: string }) => {
  const background = getColorForString("colors", firstGrapheme(name)).color;
  const cutRadius = BUBBLE_PX / 2 + RING_PX;
  const cutOut = `radial-gradient(circle at ${STACK_OFFSET_PX + BUBBLE_PX / 2}px 50%, transparent ${cutRadius}px, black ${cutRadius + 0.5}px)`;

  return (
    <Box
      role="img"
      aria-label="Aggregate project"
      position="relative"
      display="inline-flex"
      flexShrink={0}
    >
      <Box
        aria-hidden
        position="absolute"
        top={0}
        left={`-${STACK_OFFSET_PX}px`}
        width={`${BUBBLE_PX}px`}
        height={`${BUBBLE_PX}px`}
        borderRadius="full"
        background={background}
        opacity={0.5}
        css={{ maskImage: cutOut, WebkitMaskImage: cutOut }}
      />
      <ProjectAvatar name={name} />
    </Box>
  );
};
