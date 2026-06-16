import { Text } from "@chakra-ui/react";

export function TipCell({
  label,
  value,
  mono,
  isSubtle,
}: {
  label: string;
  value: string;
  mono?: boolean;
  /** Render the value in `fg.subtle` — for placeholder values like "none". */
  isSubtle?: boolean;
}) {
  return (
    <>
      <Text textStyle="2xs" color="fg.muted">
        {label}
      </Text>
      <Text
        textStyle="2xs"
        color={isSubtle ? "fg.subtle" : "fg"}
        fontFamily={mono ? "mono" : undefined}
        textAlign="right"
        wordBreak="break-all"
      >
        {value}
      </Text>
    </>
  );
}
