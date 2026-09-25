/**
 * Procedures: derived namespaces from contract, borrowed ones from features
 * not yet split. Segment names are load-bearing for React Query cache.
 */

import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { authTrpc, signInSecurityTrpc } from "@langwatch/auth-contract";
import type { inviteTrpc, joinRequestTrpc } from "@langwatch/organization-contract";
import type { identityTrpc } from "@langwatch/user-contract";

/** What an invitation link may say to whoever opens it. */
export type AuthInviteLanding = {
  organizationName: string;
  inviterName: string | null;
};

type BorrowedProcedures = {
  user: {
    register: {
      mutation: {
        input: { email: string; password: string; name?: string; confirmPassword?: string };
        output: unknown;
      };
    };
  };
};

export type AuthApiMap = ContractApiMap<typeof authTrpc> &
  ContractApiMap<typeof signInSecurityTrpc> &
  ContractApiMap<typeof joinRequestTrpc> &
  ContractApiMap<typeof inviteTrpc> &
  ContractApiMap<typeof identityTrpc> &
  BorrowedProcedures;

export const authApi = createModuleApi<AuthApiMap>();
