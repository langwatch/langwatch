/** The score editor, mounted in the host its package asks for. See dev/docs/best_practices/drawers.md#host-wrapping-in-appsui. */

import { AnnotationScoreDrawer as ScoreEditor } from "@langwatch/annotation-web/screens/annotation-scores";

import { withHost } from "../../../../ui/sections/ui-page";
import { AnnotationScoresHost } from "./annotation-scores-host";

export const AnnotationScoreEditorDrawer = withHost(AnnotationScoresHost, ScoreEditor);
