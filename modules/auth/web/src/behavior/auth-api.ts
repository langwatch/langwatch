/**
 * Procedures: derived namespaces from contract, borrowed ones from features
 * not yet split. Segment names are load-bearing for React Query cache.
 */

import type { frontDoorTrpc } from "@langwatch/auth-contract";
import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";

/** What an invitation link may say to whoever opens it. */
export type AuthInviteLanding = {
  organizationName: string;
  inviterName: string | null;
};

type BorrowedProcedures = {
  organization: {
    acceptInvite: { mutation: { input: { inviteCode: string }; output: unknown } };
  };
  user: {
    register: {
      mutation: {
        input: { email: string; password: string; name?: string; confirmPassword?: string };
        output: unknown;
      };
    };
  };
};

export type AuthApiMap = ContractApiMap<typeof frontDoorTrpc> & BorrowedProcedures;

export const authApi = createModuleApi<AuthApiMap>();
