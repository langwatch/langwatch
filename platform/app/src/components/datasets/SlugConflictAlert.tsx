import type { Alert } from "@chakra-ui/react";
import { SlugAlert } from "./SlugAlert";

/**
 * Alert component for displaying slug conflict warnings.
 *
 * Single Responsibility: Displays a warning when a dataset slug conflicts with an existing dataset.
 *
 * @param conflictsWith - The name of the dataset that already uses this slug
 */
export function SlugConflictAlert({
  conflictsWith,
  ...props
}: {
  conflictsWith: string;
} & Alert.RootProps) {
  return (
    <SlugAlert {...props}>
      A dataset named &quot;{conflictsWith}&quot; already uses this slug. Please
      choose a different name.
    </SlugAlert>
  );
}
