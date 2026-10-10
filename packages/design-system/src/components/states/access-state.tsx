import { Box, Circle, Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { ArrowUpRight, Lock, MapPinOff } from "lucide-react";
import type { ReactNode } from "react";

export type AccessStateProps = {
  kind: "upgrade" | "permission" | "unavailable";
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
  "data-testid"?: string;
};

export function AccessState({
  kind,
  title,
  description,
  actions,
  children,
  compact = false,
  "data-testid": testId,
}: AccessStateProps) {
  return (
    <Stack
      width="full"
      gap={compact ? 4 : 6}
      padding={compact ? 5 : { base: 6, md: 8 }}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="xl"
      bg="bg.panel"
      data-testid={testId}
    >
      <Stack gap={4} align="start">
        <AccessStateIcon kind={kind} compact={compact} />
        <Stack gap={2} maxWidth="64ch">
          <Heading as="h2" size={compact ? "md" : "lg"}>
            {title}
          </Heading>
          <Text color="fg.muted" fontSize="sm" lineHeight="tall">
            {description}
          </Text>
        </Stack>
      </Stack>
      {children && <Box>{children}</Box>}
      {actions && (
        <HStack gap={3} flexWrap="wrap">
          {actions}
        </HStack>
      )}
    </Stack>
  );
}

export function UpgradeRequired({
  feature,
  actions,
  compact,
  "data-testid": testId,
}: {
  feature: string;
  actions: ReactNode;
  compact?: boolean;
  "data-testid"?: string;
}) {
  return (
    <AccessState
      kind="upgrade"
      title={`${feature} on Enterprise`}
      description={`Your current plan doesn't include ${feature.toLowerCase()}. Compare plans to see what's included, or ask an organization admin about changing your plan.`}
      actions={actions}
      compact={compact}
      data-testid={testId}
    />
  );
}

export function AccessStateIcon({
  kind,
  compact = false,
}: {
  kind: AccessStateProps["kind"];
  compact?: boolean;
}) {
  const icons = { upgrade: ArrowUpRight, permission: Lock, unavailable: MapPinOff };
  const Icon = icons[kind];
  return (
    <Circle
      size={compact ? 10 : 12}
      bg={kind === "upgrade" ? "orange.subtle" : "bg.muted"}
      color={kind === "upgrade" ? "orange.fg" : "fg.muted"}
    >
      <Icon size={20} aria-hidden />
    </Circle>
  );
}
