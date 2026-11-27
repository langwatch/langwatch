/** Which boards a project starts with, for the project's agent kind. */

import type { AgentKind } from "./catalogue-labels.ts";
import {
  CATALOGUE_TEMPLATES,
  type CatalogueTemplate,
  templateForKind,
} from "./catalogue-templates.ts";

/** The templates a project of this agent kind gets made for it, each adapted to that kind. */
export function preloadedTemplatesFor({ kind }: { kind: AgentKind }): readonly CatalogueTemplate[] {
  return CATALOGUE_TEMPLATES.filter((template) => template.preloadFor.includes(kind)).map(
    (template) => templateForKind({ template, kind }),
  );
}
