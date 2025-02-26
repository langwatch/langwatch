import type { ButtonProps } from "@chakra-ui/internal";
import { IconButton as ChakraIconButton } from "@chakra-ui/internal";
import * as React from "react";
import { LuX } from "react-icons/lu";

export type CloseButtonProps = ButtonProps

export const CloseButton = React.forwardRef<
  HTMLButtonElement,
  CloseButtonProps
>(function CloseButton(props, ref) {
  return (
    <ChakraIconButton variant="ghost" aria-label="Close" ref={ref} {...props}>
      {props.children ?? <LuX />}
    </ChakraIconButton>
  )
})
