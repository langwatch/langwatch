import { Avatar, type AvatarRootProps } from "@chakra-ui/react";
import { getColorForString } from "../utils/rotatingColors";

export function RandomColorAvatar({
  name,
  ...props
}: AvatarRootProps & { name: string }) {
  return (
    <Avatar.Root
      color="white"
      background={getColorForString("colors", name).color}
      {...props}
    >
      <Avatar.Fallback name={name} />
    </Avatar.Root>
  );
}
