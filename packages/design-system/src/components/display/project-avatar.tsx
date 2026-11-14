/** A project: its first grapheme on a colour hashed from it, the same everywhere in the app. */
import { Box, VisuallyHidden } from "@chakra-ui/react";

import { firstGrapheme } from "../../first-grapheme.ts";
import { getAvatarFillForString } from "../../rotating-colors.ts";
import { Avatar } from "./avatar.tsx";

export type ProjectAvatarSize = "xs" | "sm" | "md";

/**
 * Bubble diameter as a size token: `xs` beside a dense line (a span in a trace tree), `sm` in
 * lists and switchers, `md` where it leads a row.
 */
const DIAMETER: Record<ProjectAvatarSize, string> = { xs: "4", sm: "5", md: "6" };

export interface ProjectAvatarProps {
  name: string;
  size?: ProjectAvatarSize;
}

/** Decorative: the project's name always sits beside it, so the bubble is hidden from readers. */
export function ProjectAvatar({ name, size = "sm" }: ProjectAvatarProps) {
  const initial = firstGrapheme(name);
  return (
    <Avatar.Root
      aria-hidden
      size="2xs"
      flexShrink={0}
      color="fg.onColor"
      background={getAvatarFillForString(initial)}
      width={DIAMETER[size]}
      height={DIAMETER[size]}
      textStyle={size === "xs" ? "micro" : undefined}
    >
      <Avatar.Fallback>{initial}</Avatar.Fallback>
    </Avatar.Root>
  );
}

/** The back bubble's offset and the ring cut, in px: the mask gradient takes lengths only. */
const BUBBLE_PX = 20;
const STACK_OFFSET_PX = 7;
const RING_PX = 1.5;

/**
 * An aggregate project's bubble (ADR-177): its own bubble before a fainter one, like an avatar
 * group. The back bubble overhangs left so the label stays put; the ring is a masked cut-out.
 */
export function AggregateProjectAvatar({ name }: { name: string }) {
  const background = getAvatarFillForString(firstGrapheme(name));
  const cutRadius = BUBBLE_PX / 2 + RING_PX;
  const cutOut = `radial-gradient(circle at ${STACK_OFFSET_PX + BUBBLE_PX / 2}px 50%, transparent ${cutRadius}px, black ${cutRadius + 0.5}px)`;

  return (
    <Box position="relative" display="inline-flex" flexShrink={0}>
      <Box
        aria-hidden
        position="absolute"
        top={0}
        left={`-${STACK_OFFSET_PX}px`}
        width={DIAMETER.sm}
        height={DIAMETER.sm}
        borderRadius="full"
        background={background}
        opacity={0.5}
        css={{ maskImage: cutOut, WebkitMaskImage: cutOut }}
      />
      <ProjectAvatar name={name} />
      <VisuallyHidden>Aggregate project</VisuallyHidden>
    </Box>
  );
}
