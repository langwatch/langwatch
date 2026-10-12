import { Box } from "@chakra-ui/react";
import { Avatar } from "~/components/ui/avatar";
import { firstGrapheme } from "../utils/firstGrapheme";
import { getColorForString } from "../utils/rotatingColors";

/**
 * The colored bubble standing in for a project, showing the first character
 * of its name.
 *
 * That character is passed as explicit children rather than through Chakra's
 * `name` prop, which derives initials with `charAt(0)`: for a project named
 * "🚩 Langy" that returns half a surrogate pair and the bubble paints a
 * replacement box. The initials heuristic buys nothing here anyway — a
 * project is not a person, has no first and last name, and never has a photo
 * to fall back from.
 *
 * The background hashes that same character. For an emoji-prefixed name that
 * is a different key than the half surrogate the old code hashed, so those
 * projects do change color — freezing it would mean keeping a hash of half a
 * character to preserve the palette entry of a bubble nobody could read.
 *
 * @see specs/navigation/project-avatar-initial.feature
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

/** Diameter of the default ("2xs") project bubble. */
const BUBBLE_PX = 20;
/** How far the back bubble of an aggregate sits to the left of the front one. */
const STACK_OFFSET_PX = 7;
/** Width of the gap cut around the front bubble, standing in for a ring. */
const RING_PX = 1.5;

/**
 * The bubble for an aggregate project (ADR-144): the project's own bubble in
 * front of a fainter one in the same colour, so it reads as several projects
 * in one, the way an avatar group does. It is the only cue that the project
 * takes no data of its own, so it carries the accessible name
 * "Aggregate project".
 *
 * The back bubble hangs off to the left of the 20px box instead of widening
 * it, so the front bubble and the label beside it sit exactly where a plain
 * project's do; every place this is drawn has horizontal padding to absorb
 * the overhang. The ring between the two is a transparent cut-out masked out
 * of the back bubble rather than a border in the surface colour, so it stays
 * correct on the header, the menu, a hovered row and in either colour mode.
 *
 * @see specs/governance/aggregate-project.feature
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
