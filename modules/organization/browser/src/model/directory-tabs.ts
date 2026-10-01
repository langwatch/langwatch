/** The Directory's tabs every reader has: who is here, the containers they sit in, the groups. */
export const DIRECTORY_TABS = ["people", "teams", "groups"] as const;
/** Departments join only where the organization has any and the reader may view governance. */
export type DirectoryTab = (typeof DIRECTORY_TABS)[number] | "departments";

/** The open tab lives in the address, so an old address lands on the tab it became. */
export const DIRECTORY_TAB_PARAM = "tab";

/** A tab the page does not have falls back to the people, however the address arrived. */
export function parseDirectoryTab({
  value,
  departmentsShown,
}: {
  value: string | undefined;
  departmentsShown: boolean;
}): DirectoryTab {
  const available: readonly DirectoryTab[] = departmentsShown
    ? [...DIRECTORY_TABS, "departments"]
    : DIRECTORY_TABS;
  return available.find((tab) => tab === value) ?? "people";
}

/**
 * Everybody the People tab lists: members, invitations still open, and people
 * asking to join. Undefined until all three have answered, so the tab shows no
 * number rather than one about to grow.
 */
export function peopleTabCount({
  memberCount,
  openInviteCount,
  requestCount,
}: {
  memberCount: number | undefined;
  openInviteCount: number | undefined;
  requestCount: number | undefined;
}): number | undefined {
  if (memberCount === void 0 || openInviteCount === void 0 || requestCount === void 0) {
    return void 0;
  }
  return memberCount + openInviteCount + requestCount;
}
