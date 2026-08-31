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
 * The background still hashes the same single character it always did, so no
 * existing project's color moves.
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
