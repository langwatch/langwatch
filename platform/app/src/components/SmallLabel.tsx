import { Text, type TextProps } from "@chakra-ui/react";

export function SmallLabel(props: TextProps) {
  return (
    <Text
      fontSize="11px"
      fontWeight="bold"
      textTransform="uppercase"
      color="label.fg"
      {...props}
    >
      {props.children}
    </Text>
  );
}
