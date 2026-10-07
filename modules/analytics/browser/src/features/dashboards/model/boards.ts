/**
 * The member's boards, stored as `Dashboard` rows: the names new boards get and
 * the addresses in the area. Addresses are built here and nowhere else.
 */

/** The address of the area, or of one board in it. */
export function dashboardsPath({
  projectSlug,
  dashboardId,
}: {
  projectSlug: string;
  dashboardId?: string;
}): string {
  const area = `/${projectSlug}/dashboards`;
  return dashboardId === void 0 ? area : `${area}/${encodeURIComponent(dashboardId)}`;
}

/** The templates library's segment; the route table ranks it above a board id, so none takes it. */
export const TEMPLATES_SEGMENT = "templates";

/** The address of the templates library. */
export function dashboardTemplatesPath({ projectSlug }: { projectSlug: string }): string {
  return `${dashboardsPath({ projectSlug })}/${TEMPLATES_SEGMENT}`;
}

/** The name a board gets when created blank, before the member renames it. */
export function untitledBoardName({ existingCount }: { existingCount: number }): string {
  return `Untitled dashboard ${existingCount + 1}`;
}

/** The name a duplicate is offered before numbering: the board's, marked as a copy. */
export function boardCopyName(name: string): string {
  return `${name} copy`;
}

/** A board made from a template takes its name, numbered from 2 when a board already has it. */
export function templateBoardName({
  templateName,
  existingNames,
}: {
  templateName: string;
  existingNames: readonly string[];
}): string {
  const taken = new Set(existingNames);
  const candidates = [
    templateName,
    ...Array.from({ length: taken.size }, (_, index) => `${templateName} ${index + 2}`),
  ];
  return candidates.find((name) => !taken.has(name)) ?? templateName;
}

/**
 * The board this project already made from a template, by the name `templateBoardName`
 * gives it: no board column records its template, and adding one needs a migration. A
 * renamed board is no longer matched, so the template can be added again.
 */
export function boardFromTemplateId({
  templateName,
  boards,
}: {
  templateName: string;
  boards: readonly { id: string; name: string }[];
}): string | undefined {
  const prefix = `${templateName} `;
  const isNumbered = (name: string) => {
    const suffix = name.slice(prefix.length);
    const number = Number(suffix);
    return (
      name.startsWith(prefix) &&
      Number.isInteger(number) &&
      number >= 2 &&
      String(number) === suffix
    );
  };
  return boards.find(({ name }) => name === templateName || isNumbered(name))?.id;
}
