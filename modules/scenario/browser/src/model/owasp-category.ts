import { OWASP_CATEGORIES } from "@langwatch/scenario-contract";

/** The official category name, or undefined for an id outside both lists. */
export function owaspCategoryName({ id }: { id: string }): string | undefined {
  return OWASP_CATEGORIES[id.split(":")[0]?.toUpperCase() ?? id];
}

/** "LLM07 System Prompt Leakage"; an unknown id shows as itself. */
export function owaspCategoryLabel({ id }: { id: string }): string {
  const name = owaspCategoryName({ id });
  return name ? `${id} ${name}` : id;
}

/** Whether a category's label says the same as a scenario's name, so its badge would repeat it. */
export function owaspLabelRepeatsName({ id, name }: { id: string; name: string }): boolean {
  return owaspCategoryLabel({ id }).toLowerCase() === name.trim().toLowerCase();
}
