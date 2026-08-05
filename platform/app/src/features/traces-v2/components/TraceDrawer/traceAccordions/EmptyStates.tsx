import { Button, Icon, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import type { IconType } from "react-icons";
import { LuCalendarClock } from "react-icons/lu";
import { Link } from "~/components/ui/link";

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <Text textStyle="xs" color="fg.subtle">
      {children}
    </Text>
  );
}

/**
 * Compact card for a trace signal that wasn't captured (no evals / no events
 * / no managed prompt). Several of these sit side-by-side in the summary's
 * "Other" section so the empty categories share one row instead of each
 * eating a full-width accordion — same information, a fraction of the
 * vertical space. Carries a short blurb and a single CTA to set the signal
 * up.
 */
export function EmptySignalCard({
  icon,
  title,
  description,
  ctaLabel,
  ctaHref,
  isCtaExternal = false,
}: {
  icon: IconType;
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
  isCtaExternal?: boolean;
}) {
  return (
    <VStack
      align="start"
      gap={2}
      flex="1 1 150px"
      minWidth="150px"
      padding={3}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      bg="bg.subtle"
    >
      <Icon as={icon} boxSize={4} color="fg.subtle" />
      <VStack align="start" gap={1}>
        <Text textStyle="xs" fontWeight="semibold" color="fg.muted">
          {title}
        </Text>
        <Text textStyle="2xs" color="fg.subtle">
          {description}
        </Text>
      </VStack>
      <Link href={ctaHref} isExternal={isCtaExternal} variant="plain">
        <Text textStyle="2xs" fontWeight="medium" color="blue.fg">
          {ctaLabel}
        </Text>
      </Link>
    </VStack>
  );
}

export function EmptyEventsState() {
  return (
    <VStack
      gap={2}
      alignItems="center"
      textAlign="center"
      maxWidth="220px"
      marginX="auto"
      paddingY={3}
    >
      <Icon as={LuCalendarClock} boxSize={5} color="fg.subtle" />
      <VStack gap={1}>
        <Text textStyle="xs" fontWeight="medium" color="fg.muted">
          No events recorded
        </Text>
        <Text textStyle="xs" color="fg.subtle">
          Events capture key moments like tool calls, user feedback, or custom
          milestones.
        </Text>
      </VStack>
      <Button size="xs" variant="outline" asChild>
        <a
          href="https://docs.langwatch.ai/integration/overview"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn more
        </a>
      </Button>
    </VStack>
  );
}
