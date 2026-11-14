/**
 * One access request on the approval page: the read, the passkey ceremony over exactly what the
 * page shows (the spend tick and typed name go into the signed challenge), and deny.
 */

import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { useState } from "react";

import { signWithPasskey } from "./passkey-ceremony.ts";
import { staffAccessApi } from "./staff-access-api.ts";

/** Refusals that mean the request moved on; the page rereads it to show where it is now. */
const MOVED_ON = new Set(["request_expired", "request_not_pending"]);

export function useApproval({ requestId }: { requestId: string }) {
  const utils = staffAccessApi.useUtils();
  const request = staffAccessApi.staffAccess.getApprovalRequest.useQuery(
    { requestId },
    { enabled: requestId !== "" },
  );
  const options = staffAccessApi.staffAccess.approvalOptions.useMutation();
  const approve = staffAccessApi.staffAccess.approve.useMutation();
  const deny = staffAccessApi.staffAccess.deny.useMutation();
  const [failure, setFailure] = useState<unknown>(null);
  const [signing, setSigning] = useState(false);

  const settle = async (error: unknown) => {
    setFailure(error);
    if (MOVED_ON.has(readHandledError(error)?.code ?? "")) await request.refetch();
  };

  const approveWithPasskey = async ({
    spendApproved,
    typedOrganizationName,
  }: {
    spendApproved: boolean;
    typedOrganizationName: string | undefined;
  }) => {
    setFailure(null);
    setSigning(true);
    try {
      const choice = {
        requestId,
        spendApproved,
        ...(typedOrganizationName === undefined ? {} : { typedOrganizationName }),
      };
      const assertionOptions = await options.mutateAsync(choice);
      const assertion = await signWithPasskey(assertionOptions);
      const view = await approve.mutateAsync({ ...choice, assertion });
      utils.staffAccess.getApprovalRequest.setData({ requestId }, view);
    } catch (error) {
      await settle(error);
    } finally {
      setSigning(false);
    }
  };

  const denyRequest = async () => {
    setFailure(null);
    try {
      const view = await deny.mutateAsync({ requestId });
      utils.staffAccess.getApprovalRequest.setData({ requestId }, view);
    } catch (error) {
      await settle(error);
    }
  };

  return {
    request,
    failure,
    signing,
    denying: deny.isPending,
    approveWithPasskey,
    denyRequest,
  };
}
