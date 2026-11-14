/**
 * One on/off setting in a bordered row, the same in a dialog and on a page: label and hint left,
 * the switch right (or, where it is not offered, the reason's action), the border up while on.
 */
import { HStack, Stack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

export interface ToggleRowProps {
  label: ReactNode;
  /** One sentence on what turning it on does. */
  hint?: ReactNode;
  /** The setting is on: the border steps up. */
  on?: boolean;
  /** The switch, labelled by the same words as `label`; or an action where it is not offered. */
  children: ReactNode;
  "data-testid"?: string;
}

export function ToggleRow({
  label,
  hint,
  on = false,
  children,
  "data-testid": testId,
}: ToggleRowProps) {
  return (
    <HStack
      justify="space-between"
      align="center"
      gap={4}
      borderWidth="1px"
      borderColor={on ? "border.emphasized" : "border"}
      borderRadius="l2"
      paddingX={3}
      paddingY={2.5}
      data-testid={testId}
      data-on={on || undefined}
    >
      <Stack gap={0} minWidth={0}>
        <Text textStyle="label">{label}</Text>
        {hint ? (
          <Text textStyle="caption" color="fg.muted">
            {hint}
          </Text>
        ) : null}
      </Stack>
      <HStack flexShrink={0}>{children}</HStack>
    </HStack>
  );
}
