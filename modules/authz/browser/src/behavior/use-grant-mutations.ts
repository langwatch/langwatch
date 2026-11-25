// Granting, changing and revoking: each refreshes the lists and tells the reader, or reports.

import { toDate } from "@langwatch/time";

import { useAuthzHost } from "../model/authz-host.ts";
import type { GrantDraft } from "../model/grants/grant-draft.ts";
import { authzApi } from "./authz-api.ts";

export function useGrantSave({
  organizationId,
  onSaved,
}: {
  organizationId: string;
  onSaved: () => void;
}) {
  const host = useAuthzHost();
  const utils = authzApi.useUtils();
  const saved = (title: string) => {
    void utils.authz.listGrants.invalidate();
    void utils.authz.listManagedGrants.invalidate();
    host.succeeded({ title });
    onSaved();
  };
  const createGrant = authzApi.authz.createGrant.useMutation({
    onSuccess: () => saved("Role granted"),
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't grant this role" }),
  });
  const changeGrantRole = authzApi.authz.changeGrantRole.useMutation({
    onSuccess: () => saved("Role changed"),
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't change this role" }),
  });

  return {
    isSaving: createGrant.isPending || changeGrantRole.isPending,
    create: ({ expiresAt, ...grant }: GrantDraft) =>
      createGrant.mutate({
        organizationId,
        grant: { ...grant, ...(expiresAt ? { expiresAt: toDate(expiresAt) } : {}) },
      }),
    changeRole: ({ grantId, roleId }: { grantId: string; roleId: string }) =>
      changeGrantRole.mutate({ organizationId, grantId, roleId }),
  };
}

export function useGrantRevoke({ organizationId }: { organizationId: string }) {
  const host = useAuthzHost();
  const utils = authzApi.useUtils();
  const revokeGrant = authzApi.authz.revokeGrant.useMutation({
    onSuccess: () => {
      void utils.authz.listGrants.invalidate();
      void utils.authz.listManagedGrants.invalidate();
      host.succeeded({ title: "Access revoked" });
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't revoke this access" }),
  });

  return {
    isRevoking: revokeGrant.isPending,
    revoke: ({ grantId, onSettled }: { grantId: string; onSettled: () => void }) =>
      revokeGrant.mutate({ organizationId, grantId }, { onSettled }),
  };
}
