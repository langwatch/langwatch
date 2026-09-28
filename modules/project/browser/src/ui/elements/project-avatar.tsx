import { Avatar } from "@langwatch/design-system/avatar";
import { firstGrapheme } from "@langwatch/design-system/first-grapheme";
import { getColorForString } from "@langwatch/design-system/rotating-colors";

/** A project's initial on a colour hashed from it, as main's switcher drew it. */
export function ProjectAvatar({ name }: { name: string }) {
  const initial = firstGrapheme(name);
  return (
    <Avatar.Root
      size="2xs"
      color="white"
      background={getColorForString("colors", initial).color}
      width="20px"
      height="20px"
    >
      <Avatar.Fallback>{initial}</Avatar.Fallback>
    </Avatar.Root>
  );
}
