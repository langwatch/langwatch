import { Box } from "@chakra-ui/react";
import { LogoIcon } from "../../icons/LogoIcon";

export function Logo3D() {
  return (
    <Box
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      filter="drop-shadow(0px 2px 3px rgba(0, 0, 0, 0.15)) drop-shadow(0px 4px 6px rgba(0, 0, 0, 0.1))"
      style={{
        transform: "perspective(500px) rotateX(5deg) rotateY(-5deg)",
      }}
    >
      <LogoIcon width={19} height={26} />
    </Box>
  );
}
