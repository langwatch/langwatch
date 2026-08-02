import { toaster } from "../components/ui/toaster";
import { api } from "../utils/api";

/**
 * Disabling and re-enabling a membership, which is how an organization
 * reconciles down to the seats its license covers.
 *
 * Re-enabling can be refused by the server when it would take the organization
 * back over its seats, so the failure message is surfaced rather than swallowed
 * behind a generic retry prompt: it is the one thing that tells the admin they
 * have to free a seat first. See seat-reconciliation.feature.
 */
export function useMemberDisableAction({
  organizationId,
  onChanged,
}: {
  organizationId: string;
  onChanged: () => void;
}) {
  const mutation = api.organization.setMemberDisabled.useMutation();

  const setMemberDisabled = (userId: string, disabled: boolean) => {
    mutation.mutate(
      { organizationId, userId, disabled },
      {
        onSuccess: () => {
          toaster.create({
            title: disabled ? "Member disabled" : "Member enabled",
            description: disabled
              ? "They no longer have access, and their seat is available again."
              : "They have access again and are using a seat.",
            type: "success",
            duration: 5000,
            meta: { closable: true },
          });
          onChanged();
        },
        onError: (error) => {
          toaster.create({
            title: disabled
              ? "Couldn't disable this member"
              : "Couldn't enable this member",
            description: error.message,
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  return { setMemberDisabled, isSettingDisabled: mutation.isLoading };
}
