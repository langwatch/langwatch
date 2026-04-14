import { HStack, Stat, Text } from "@chakra-ui/react";
import { ArrowUpRight } from "lucide-react";
import NextLink from "next/link";

export function LinkedStat({
  label,
  value,
  sublabel,
  href,
  color,
}: {
  label: string;
  value: string;
  sublabel?: string;
  href?: string;
  color?: string;
}) {
  const content = (
    <Stat.Root
      cursor={href ? "pointer" : undefined}
      _hover={href ? { bg: "bg.subtle" } : undefined}
      borderRadius="md"
      padding={2}
      transition="background 0.1s"
    >
      <Stat.Label>
        <HStack gap={1}>
          <Text>{label}</Text>
          {href && <ArrowUpRight size={10} />}
        </HStack>
      </Stat.Label>
      <HStack gap={1.5} alignItems="baseline">
        <Stat.ValueText color={color}>{value}</Stat.ValueText>
        {sublabel && (
          <Text textStyle="xs" color="fg.muted" fontWeight="normal">
            {sublabel}
          </Text>
        )}
      </HStack>
    </Stat.Root>
  );

  if (!href) return content;

  return (
    <NextLink href={href} style={{ textDecoration: "none" }}>
      {content}
    </NextLink>
  );
}
