import type { Alert } from "@langwatch/design-system/primitives";

import { SlugAlert } from "./slug-alert.tsx";

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
