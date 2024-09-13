import { Text, type TextProps } from "@chakra-ui/react";

export function SmallLabel(props: TextProps) {
  return (
    <Text fontSize={11} fontWeight="bold" textTransform="uppercase" {...props}>
      {props.children}
    </Text>
  );
}
