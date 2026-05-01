import { Text, type TextProps } from "@chakra-ui/react";
import type React from "react";

export const MonoCell: React.FC<TextProps> = ({ children, ...rest }) => (
  <Text
    fontFamily="mono"
    color="fg.muted"
    whiteSpace="nowrap"
    textStyle="xs"
    {...rest}
  >
    {children}
  </Text>
);
