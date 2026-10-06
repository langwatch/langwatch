/**
 * Which boards a project starts with, and which widgets each board shows for the
 * project's agent kind.
 */

import type { AgentKind } from "./catalogue-labels.ts";
import { CATALOGUE_TEMPLATES, type CatalogueTemplate } from "./catalogue-templates.ts";

/** A template's widgets, top to bottom, for one agent kind. */
export function templateWidgetsFor({
  template,
  kind,
}: {
  template: CatalogueTemplate;
  kind: AgentKind;
}): readonly string[] {
  return template.byAgentKind[kind] ?? template.widgets;
}

/** The templates a project of this agent kind gets made for it, in catalogue order. */
export function preloadedTemplatesFor({ kind }: { kind: AgentKind }): readonly CatalogueTemplate[] {
  return CATALOGUE_TEMPLATES.filter((template) => template.preloadFor.includes(kind));
}
