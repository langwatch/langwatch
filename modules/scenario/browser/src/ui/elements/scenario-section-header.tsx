import { Text, type TextProps } from "@chakra-ui/react";

type ScenarioSectionHeaderProps = {
  children: React.ReactNode;
} & TextProps;

export function ScenarioSectionHeader({ children, ...props }: ScenarioSectionHeaderProps) {
  return (
    <Text
      fontSize="11px"
      fontWeight="bold"
      textTransform="uppercase"
      color="fg.muted"
      letterSpacing="0.5px"
      {...props}
    >
      {children}
    </Text>
  );
}
