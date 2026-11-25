/** The score editor as an address-routed drawer, so another module's flow navigates to it. */

import { useDrawer } from "@langwatch/browser-host/drawer";

import { AnnotationScoreDrawer } from "./annotation-score-drawer.tsx";

export function RoutedAnnotationScoreDrawer({
  onClose,
  annotationScoreId,
}: {
  onClose?: () => void;
  annotationScoreId?: string;
}) {
  const { closeDrawer } = useDrawer();
  return (
    <AnnotationScoreDrawer onClose={onClose ?? closeDrawer} annotationScoreId={annotationScoreId} />
  );
}
