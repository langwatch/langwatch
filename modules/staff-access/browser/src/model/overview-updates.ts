/** How a write changes the agents page's overview in place, so it needs no reread. */

import type {
  StaffAccessOverview,
  StaffAccessRequesterView,
} from "@langwatch/staff-access-contract";

type Overview = Pick<StaffAccessOverview, "requesters" | "sessions">;

export function withEnrolledRequester<T extends Overview>({
  overview,
  requester,
}: {
  overview: T;
  requester: StaffAccessRequesterView;
}): T {
  return { ...overview, requesters: [requester, ...overview.requesters] };
}

export function withRevokedRequester<T extends Overview>({
  overview,
  requesterId,
  revokedAt,
}: {
  overview: T;
  requesterId: string;
  revokedAt: string;
}): T {
  return {
    ...overview,
    requesters: overview.requesters.map((requester) =>
      requester.id === requesterId ? { ...requester, revokedAt } : requester,
    ),
  };
}

export function withRevokedSession<T extends Overview>({
  overview,
  requestId,
  revokedAt,
}: {
  overview: T;
  requestId: string;
  revokedAt: string;
}): T {
  return {
    ...overview,
    sessions: overview.sessions.map((session) =>
      session.requestId === requestId
        ? { ...session, status: "revoked" as const, revokedAt }
        : session,
    ),
  };
}
