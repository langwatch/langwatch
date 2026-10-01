import type { Alert } from "@langwatch/design-system/primitives";

import { SlugAlert } from "./slug-alert.tsx";

/** Warns that changing a Dataset slug invalidates external references. */
export function SlugChangeWarningAlert(props: Alert.RootProps) {
  return (
    <SlugAlert {...props}>
      Warning: this will break external references to this dataset. Please update your references to
      the new slug after saving.
    </SlugAlert>
  );
}
