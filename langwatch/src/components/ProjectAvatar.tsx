import { RandomColorAvatar } from "./RandomColorAvatar";

export const ProjectAvatar = ({
  name,
  size = "2xs",
}: {
  name: string;
  size?: "2xs" | "xs" | "sm";
}) => {
  return (
    <RandomColorAvatar
      size={size}
      name={name.slice(0, 1)}
      width={size === "2xs" ? "20px" : undefined}
      height={size === "2xs" ? "20px" : undefined}
    />
  );
};
