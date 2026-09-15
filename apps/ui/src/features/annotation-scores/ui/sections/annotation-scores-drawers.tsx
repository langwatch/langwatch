import { AnnotationScoreDrawer as ScoreEditor } from "@langwatch/annotation-web/annotation-scores";

import { withHost } from "../../../../ui/sections/ui-page";
import { AnnotationScoresHost } from "./annotation-scores-host";

export const AnnotationScoreEditorDrawer = withHost(AnnotationScoresHost, ScoreEditor);
