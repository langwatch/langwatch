import { Alert } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

/** Base warning surface shared by Dataset slug validation messages. */
export function SlugAlert({ children, ...props }: { children: ReactNode } & Alert.RootProps) {
  return (
    <Alert.Root status="warning" size="sm" {...props}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{children}</Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

/** Shows the Dataset name that already owns a proposed slug. */
export function SlugConflictAlert({
  conflictsWith,
  ...props
}: {
  conflictsWith: string;
} & Alert.RootProps) {
  return (
    <SlugAlert {...props}>
      A dataset named &quot;{conflictsWith}&quot; already uses this slug. Please choose a different
      name.
    </SlugAlert>
  );
}
