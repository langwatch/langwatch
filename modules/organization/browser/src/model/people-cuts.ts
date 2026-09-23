/** The members page's cuts, in the order somebody arrives through them. */
export const PEOPLE_CUTS = ["all", "members", "invited", "waiting"] as const;
export type PeopleCut = (typeof PEOPLE_CUTS)[number];

/** The open cut lives in the address, so a link lands on the people it was sent about. */
export const PEOPLE_CUT_PARAM = "people";

export function parsePeopleCut(value: string | undefined): PeopleCut {
  return PEOPLE_CUTS.find((cut) => cut === value) ?? "all";
}

/** Every cut carries its number, zero included: a quiet week is an answer. */
export function peopleCutItems({
  memberCount,
  openInviteCount,
  requestCount,
}: {
  memberCount: number;
  openInviteCount: number;
  requestCount: number;
}): { value: PeopleCut; label: string; count: number }[] {
  return [
    { value: "all", label: "Everybody", count: memberCount + openInviteCount + requestCount },
    { value: "members", label: "Members", count: memberCount },
    { value: "invited", label: "Invited", count: openInviteCount },
    { value: "waiting", label: "Waiting to join", count: requestCount },
  ];
}

/** What an empty cut says; never one sentence for all four. */
export function emptyPeopleCutText(cut: PeopleCut): string {
  if (cut === "invited") return "Nobody has an outstanding invitation.";
  if (cut === "waiting") {
    return "Nobody is waiting to join. People with a verified address on your domain can ask, if your joining policy allows it.";
  }
  if (cut === "members") return "Nobody is a member of this organization yet.";
  return "Nobody is here yet, and nobody is on their way in.";
}

/** Which of the three lists a cut shows; `all` shows every one. */
export function peopleCutShows({
  cut,
  list,
}: {
  cut: PeopleCut;
  list: Exclude<PeopleCut, "all">;
}): boolean {
  return cut === "all" || cut === list;
}

/** Whether the one list a filtered cut shows has nobody in it. */
export function peopleCutIsEmpty({
  cut,
  members,
  invites,
  requests,
}: {
  cut: PeopleCut;
  members: number;
  invites: number;
  requests: number;
}): boolean {
  if (cut === "all") return false;
  if (cut === "members") return members === 0;
  if (cut === "invited") return invites === 0;
  return requests === 0;
}
