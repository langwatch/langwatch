/**
 * The score editor, mounted in the host its package asks for.
 *
 * A DRAWER IS NOT A PAGE: it opens over whatever page the reader is on, so the
 * host travels with the drawer rather than with the address. Wrapping happens
 * here, once, and the whole file is behind the registry's lazy import.
 */

import { AnnotationScoreDrawer as ScoreEditor } from "@langwatch/annotation-web/screens/annotation-scores";

import { withHost } from "../../../../ui/sections/ui-page";
import { AnnotationScoresHost } from "./annotation-scores-host";

export const AnnotationScoreEditorDrawer = withHost(AnnotationScoresHost, ScoreEditor);
