import { HStack, Stat, Text } from "@chakra-ui/react";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

export interface LinkedStatProps {
  label: string;
  value: string;
  sublabel?: string;
  href?: string;
  color?: string;
  testId?: string;
  warning?: boolean;
  /** Hover explanation of what the figure is measured over. */
  hint?: string;
  /** App/router-owned link wrapper; defaults to a normal anchor. */
  link?: (content: ReactNode, href: string) => ReactNode;
}

/** A compact stat tile that can optionally link to an operator drill-down. */
export function LinkedStat({
  label,
  value,
  sublabel,
  href,
  color,
  testId,
  warning,
  hint,
  link,
}: LinkedStatProps) {
  const warningAttribute = warning === void 0 ? void 0 : warning ? "true" : "false";
  const content = (
    <Stat.Root
      cursor={href ? "pointer" : void 0}
      _hover={href ? { bg: "bg.subtle" } : void 0}
      borderRadius="md"
      padding={2}
      transition="background 0.1s"
      data-testid={testId}
      title={hint}
      data-warning={warningAttribute}
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
        <Text textStyle="xs" color="fg.muted" fontWeight="normal" whiteSpace="nowrap">
          {sublabel}
        </Text>
      )}
    </Stat.Root>
  );

  if (!href) return content;

  return link ? (
    link(content, href)
  ) : (
    <a href={href} style={{ textDecoration: "none" }}>
      {content}
    </a>
  );
}
