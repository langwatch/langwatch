/** Board templates: ready boards of stored widgets a member starts a dashboard from. */

import { GALLERY_TEMPLATES } from "../catalogue/index.ts";
import type { BoardTemplate } from "./model/board-template.ts";

export type {
  BoardTemplate,
  BoardTemplateId,
  BoardTemplateWidget,
  TemplateProgress,
} from "./model/board-template.ts";

/** Every template the gallery offers: the catalogue's, the ones that can be made first. */
export const BOARD_TEMPLATES: readonly BoardTemplate[] = GALLERY_TEMPLATES;
