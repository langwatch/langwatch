import { Text } from "@chakra-ui/react";

export function TipCell({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <>
      <Text textStyle="2xs" color="fg.muted">
        {label}
      </Text>
      <Text
        textStyle="2xs"
        color="fg"
        fontFamily={mono ? "mono" : undefined}
        textAlign="right"
        wordBreak="break-all"
      >
        {value}
      </Text>
    </>
  );
}
