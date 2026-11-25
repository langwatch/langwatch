/** The score-settings reads, on the settings transport. */

import { annotationScoresApi } from "./annotation-scores-api.ts";

/** Every score type of the project, for the settings table. */
export function useScoreSettings({ projectId }: { projectId: string | undefined }) {
  return annotationScoresApi.annotationScore.getAll.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );
}

/** One score type, for the settings form's edit mode. */
export function useScoreSetting({
  projectId,
  scoreId,
}: {
  projectId: string | undefined;
  scoreId: string | undefined;
}) {
  return annotationScoresApi.annotationScore.getById.useQuery(
    { projectId: projectId ?? "", scoreId: scoreId ?? "" },
    { enabled: !!scoreId && !!projectId },
  );
}
