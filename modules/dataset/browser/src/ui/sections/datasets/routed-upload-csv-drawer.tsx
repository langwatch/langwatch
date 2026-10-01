/** The CSV upload as an address-routed drawer, so another module's flow navigates to it. */

import type { UiUploadCsvDrawerProps } from "@langwatch/browser-host/drawer";

import { UploadCSVDrawer } from "./upload-csv-drawer.tsx";

export function RoutedUploadCsvDrawer({
  onClose,
  onSuccess,
  enableDirectUpload,
}: UiUploadCsvDrawerProps) {
  return (
    <UploadCSVDrawer
      onClose={onClose}
      onSuccess={(dataset) => onSuccess?.(dataset)}
      // A flag read back off the address arrives as text, so "false" reads as false too.
      enableDirectUpload={String(enableDirectUpload) !== "false"}
    />
  );
}
