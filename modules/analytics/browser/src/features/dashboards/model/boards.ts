/**
 * The member's boards, stored as `Dashboard` rows: which one the area opens
 * on, and the names new boards get. Addresses are built here and nowhere else.
 */

/** The board made for a member who can see none, so the area never opens empty. */
export const FIRST_BOARD_NAME = "My dashboard";

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

/**
 * The board `/[project]/dashboards` opens: the member's first own board, else
 * the first they can see; undefined when they can see none.
 */
export function landingBoardId({
  boards,
  userId,
}: {
  boards: readonly { id: string; createdById: string | null }[];
  userId: string | undefined;
}): string | undefined {
  const own = boards.find(({ createdById }) => userId !== void 0 && createdById === userId);
  return (own ?? boards[0])?.id;
}

/** The name a board gets when created from the sidebar, before the member renames it. */
export function untitledBoardName({ existingCount }: { existingCount: number }): string {
  return `Untitled dashboard ${existingCount + 1}`;
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
