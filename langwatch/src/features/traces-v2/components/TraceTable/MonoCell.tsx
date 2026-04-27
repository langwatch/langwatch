import { Text, type TextProps } from "@chakra-ui/react";
import type React from "react";

/**
 * Monospace value cell used across the trace tables (duration, cost, tokens, model).
 * Defaults: `fontFamily="mono"`, `color="fg.muted"`, no-wrap.
 */
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
