/** The host address controls the score editor overlay. */

import { Drawer } from "@langwatch/design-system/drawer";

import { useAnnotationScoresHost } from "../../model/annotation-scores-host.ts";
import { AnnotationScoreForm } from "./annotation-score-form.tsx";

export const AnnotationScoreDrawer = ({
  onClose,
  annotationScoreId,
}: {
  onClose?: () => void;
  annotationScoreId?: string | undefined;
}) => {
  const host = useAnnotationScoresHost();

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      host.closeEditor();
    }
  };

  return (
    <Drawer
      onClose={handleClose}
      size="lg"
      title={annotationScoreId ? "Edit Score Metric" : "Add Score Metric"}
    >
      <AnnotationScoreForm onClose={handleClose} annotationScoreId={annotationScoreId} />
    </Drawer>
  );
};
