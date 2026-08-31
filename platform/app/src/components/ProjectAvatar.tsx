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
