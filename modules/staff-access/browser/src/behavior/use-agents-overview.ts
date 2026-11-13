/**
 * The agents page: my enrolled agents, every operator's sessions, enrolment with a passkey and
 * the revokes. Writes update the overview in place, then reread it: a revoke on the server can
 * end more than the row it names (revoking an agent ends its sessions).
 */

import type { StaffAccessEnrolled } from "@langwatch/staff-access-contract";
import { nowInstant } from "@langwatch/time";
import { useState } from "react";

import {
  withEnrolledRequester,
  withRevokedRequester,
  withRevokedSession,
} from "../model/overview-updates.ts";
import { signWithPasskey } from "./passkey-ceremony.ts";
import { staffAccessApi } from "./staff-access-api.ts";

export function useAgentsOverview() {
  const utils = staffAccessApi.useUtils();
  const overview = staffAccessApi.staffAccess.overview.useQuery();
  const enrolOptions = staffAccessApi.staffAccess.enrolOptions.useMutation();
  const enrol = staffAccessApi.staffAccess.enrol.useMutation();
  const revokeRequester = staffAccessApi.staffAccess.revokeRequester.useMutation();
  const revokeSession = staffAccessApi.staffAccess.revokeSession.useMutation();
  const revokeAll = staffAccessApi.staffAccess.revokeAll.useMutation();
  const [enrolling, setEnrolling] = useState(false);

  const enrolAgent = async ({ name }: { name: string }): Promise<StaffAccessEnrolled> => {
    setEnrolling(true);
    try {
      const assertion = await signWithPasskey(await enrolOptions.mutateAsync());
      const enrolled = await enrol.mutateAsync({ name, assertion });
      utils.staffAccess.overview.setData(
        void 0,
        (overview) =>
          overview && withEnrolledRequester({ overview, requester: enrolled.requester }),
      );
      void overview.refetch();
      return enrolled;
    } finally {
      setEnrolling(false);
    }
  };

  const revokeAgent = async ({ requesterId }: { requesterId: string }) => {
    await revokeRequester.mutateAsync({ requesterId });
    const revokedAt = nowInstant().toString();
    utils.staffAccess.overview.setData(
      void 0,
      (overview) => overview && withRevokedRequester({ overview, requesterId, revokedAt }),
    );
    await overview.refetch();
  };

  const endSession = async ({ requestId }: { requestId: string }) => {
    await revokeSession.mutateAsync({ requestId });
    const revokedAt = nowInstant().toString();
    utils.staffAccess.overview.setData(
      void 0,
      (overview) => overview && withRevokedSession({ overview, requestId, revokedAt }),
    );
    await overview.refetch();
  };

  const revokeEverything = async ({ confirmation }: { confirmation: string }) => {
    const result = await revokeAll.mutateAsync({ confirmation });
    await overview.refetch();
    return result;
  };

  return {
    overview,
    enrolling,
    enrolAgent,
    revokeAgent,
    revokingAgent: revokeRequester.isPending,
    endSession,
    endingSession: revokeSession.isPending,
    revokeEverything,
    revokingEverything: revokeAll.isPending,
  };
}
