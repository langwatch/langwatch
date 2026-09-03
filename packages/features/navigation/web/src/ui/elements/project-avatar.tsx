import { Avatar } from "@langwatch/design-system/avatar";
import { firstGrapheme } from "@langwatch/design-system/first-grapheme";
import { getColorForString } from "@langwatch/design-system/rotating-colors";

/**
 * The project chip's avatar: the project's first letter on a background hashed
 * from its name, so the same project is the same colour everywhere.
 *
 * Moved from `platform/app/src/components/ProjectAvatar.tsx`. That file reached
 * the same pixels through `RandomColorAvatar` → `UserAvatar`, a person-avatar
 * chain whose image/silhouette fallbacks a project never has: it is always
 * called with a one-character `name` and never with an `image`. Those two
 * components belong to the people surfaces that still use them and did not
 * travel, so the initials-only path they resolve to for a project is written
 * out here. Same size defaults, same colour source, same output.
 *
 * The initial is a GRAPHEME and is handed to the avatar as children, not as
 * `name`: `slice(0, 1)` cuts an astral emoji in half, and the avatar re-derives
 * initials with `charAt(0)` from any `name` it is given, so either route paints
 * a replacement box for a project named "🚩 Langy". The background hashes that
 * same grapheme, so an emoji-prefixed project also changes colour — freezing it
 * would mean keeping the hash of half a character.
 *
 * Spec: specs/navigation/project-avatar-initial.feature
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
