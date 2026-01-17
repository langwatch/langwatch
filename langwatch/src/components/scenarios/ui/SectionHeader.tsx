import { Text, type TextProps } from "@chakra-ui/react";

type SectionHeaderProps = {
  children: React.ReactNode;
} & TextProps;

/**
 * Section header for scenario forms.
 * Uppercase, gray, small text.
 */
export function SectionHeader({ children, ...props }: SectionHeaderProps) {
  return (
    <Text
      fontSize="11px"
      fontWeight="bold"
      textTransform="uppercase"
      color="gray.500"
      letterSpacing="0.5px"
      {...props}
    >
      {children}
    </Text>
  );
}
