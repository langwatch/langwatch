import { Avatar } from "@langwatch/design-system/avatar";
import { firstGrapheme } from "@langwatch/design-system/first-grapheme";
import { getColorForString } from "@langwatch/design-system/rotating-colors";

/** Project avatar: first grapheme on background color hashed from name. */
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
