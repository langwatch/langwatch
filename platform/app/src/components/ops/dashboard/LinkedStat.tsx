import { HStack, Stat, Text } from "@chakra-ui/react";
import { ArrowUpRight } from "lucide-react";
import NextLink from "~/utils/compat/next-link";

export function LinkedStat({
  label,
  value,
  sublabel,
  href,
  color,
  testId,
  warning,
}: {
  label: string;
  value: string;
  sublabel?: string;
  href?: string;
  color?: string;
  testId?: string;
  warning?: boolean;
}) {
  const content = (
    <Stat.Root
      cursor={href ? "pointer" : undefined}
      _hover={href ? { bg: "bg.subtle" } : undefined}
      borderRadius="md"
      padding={2}
      transition="background 0.1s"
      data-testid={testId}
      data-warning={
        warning === undefined ? undefined : warning ? "true" : "false"
      }
    >
      <Stat.Label whiteSpace="nowrap">
        <HStack gap={1}>
          <Text>{label}</Text>
          {href && <ArrowUpRight size={10} />}
        </HStack>
      </Stat.Label>
      <Stat.ValueText color={color} whiteSpace="nowrap">
        {value}
      </Stat.ValueText>
      {sublabel && (
        <Text
          textStyle="xs"
          color="fg.muted"
          fontWeight="normal"
          whiteSpace="nowrap"
        >
          {sublabel}
        </Text>
      )}
    </Stat.Root>
  );

  if (!href) return content;

  return (
    <NextLink href={href} style={{ textDecoration: "none" }}>
      {content}
    </NextLink>
  );
}
