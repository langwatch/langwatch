import { type Alert } from "@chakra-ui/react";
import { SlugAlert } from "./SlugAlert";

/**
 * Alert component for warning about slug changes breaking external references.
 *
 * Single Responsibility: Displays a warning that changing the slug will break external references.
 */
export function SlugChangeWarningAlert(props: Alert.RootProps) {
  return (
    <SlugAlert {...props}>
      Warning: this will break external references to this dataset. Please
      update your references to the new slug after saving.
    </SlugAlert>
  );
}
