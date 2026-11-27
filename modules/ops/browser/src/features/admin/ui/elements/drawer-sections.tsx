import { Box, HStack, IconButton, Text, VStack } from "@langwatch/design-system/primitives";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";

/** One labeled value in a drawer's detail grid. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <VStack align="start" gap={0}>
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text as="div">{children}</Text>
    </VStack>
  );
}

/** A titled, top-bordered group of drawer content. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <VStack
      align="start"
      gap={3}
      width="full"
      borderTopWidth="1px"
      borderColor="border"
      paddingTop={4}
    >
      <Text fontWeight="semibold">{title}</Text>
      {children}
    </VStack>
  );
}

/**
 * A bordered drawer part with a one-line summary. With `onToggle` it opens
 * and shuts from its header; without, it stays open.
 */
export function Panel({
  title,
  summary,
  actions,
  open = true,
  onToggle,
  highlighted = false,
  children,
  "data-testid": testId,
}: {
  title: string;
  summary?: ReactNode;
  actions?: ReactNode;
  open?: boolean;
  onToggle?: () => void;
  highlighted?: boolean;
  children?: ReactNode;
  "data-testid"?: string;
}) {
  const showBody = open && children !== undefined && children !== null && children !== false;
  return (
    <VStack
      align="stretch"
      gap={0}
      width="full"
      borderWidth="1px"
      borderColor={highlighted ? "border.emphasized" : "border"}
      borderRadius="lg"
      data-testid={testId}
    >
      <HStack gap={3} paddingX={4} paddingY={3} align="center">
        <VStack align="start" gap={0} flex={1} minWidth={0}>
          <Text fontWeight="semibold" fontSize="sm">
            {title}
          </Text>
          {summary ? (
            <Text as="div" fontSize="xs" color="fg.muted">
              {summary}
            </Text>
          ) : null}
        </VStack>
        {actions}
        {onToggle ? (
          <IconButton
            aria-label={open ? `Shut ${title}` : `Open ${title}`}
            aria-expanded={open}
            size="xs"
            variant="ghost"
            onClick={onToggle}
          >
            {open ? <ChevronUp /> : <ChevronDown />}
          </IconButton>
        ) : null}
      </HStack>
      {showBody ? (
        <VStack
          align="stretch"
          gap={3}
          paddingX={4}
          paddingBottom={4}
          paddingTop={3}
          borderTopWidth="1px"
          borderColor="border"
        >
          {children}
        </VStack>
      ) : null}
    </VStack>
  );
}

/** One labelled value of a panel, with the action that changes it. */
export function TermRow({
  label,
  children,
  action,
}: {
  label: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <HStack gap={3} align="center" width="full" fontSize="sm" minHeight="8">
      <Text color="fg.muted" width="32" flexShrink={0}>
        {label}
      </Text>
      <Box flex={1} minWidth={0}>
        {children}
      </Box>
      {action}
    </HStack>
  );
}
