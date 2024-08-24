import { Box } from "@chakra-ui/react";
import type { ComponentProps } from "react";

export const IconWrapper = (props: ComponentProps<typeof Box>) => {
  return (
    <Box
      width="64px"
      height="64px"
      display="flex"
      alignItems="center"
      justifyContent="center"
      {...props}
    >
      {props.children}
    </Box>
  );
};
