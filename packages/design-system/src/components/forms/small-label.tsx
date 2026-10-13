import { Text, type TextProps } from "@chakra-ui/react";

export function SmallLabel(props: TextProps) {
  return (
    <Text textStyle="eyebrow" color="label.fg" {...props}>
      {props.children}
    </Text>
  );
}
