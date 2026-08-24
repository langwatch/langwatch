import type { Alert } from "@chakra-ui/react";
import { SlugAlert } from "./slug-alert";

/** Warns that changing a Dataset slug invalidates external references. */
export function SlugChangeWarningAlert(props: Alert.RootProps) {
  return (
    <SlugAlert {...props}>
      Warning: this will break external references to this dataset. Please
      update your references to the new slug after saving.
    </SlugAlert>
  );
}
