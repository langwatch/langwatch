import { toaster } from "../components/ui/toaster";
import { showErrorToast } from "../features/errors";
import { api } from "../utils/api";

/**
 * Disabling and re-enabling a membership, which is how an organization
 * reconciles down to the seats its license covers.
 *
 * Re-enabling can be refused by the server when it would take the organization
 * back over its seats. That refusal carries the license-limit shape, so the
 * global handler opens the limit modal with the current and licensed seat
 * counts and `showErrorToast` stays quiet rather than reporting it twice. See
 * seat-reconciliation.feature.
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
          showErrorToast({
            error,
            fallbackTitle: disabled
              ? "Couldn't disable this member"
              : "Couldn't enable this member",
          });
        },
      },
    );
  };

  return { setMemberDisabled, isSettingDisabled: mutation.isLoading };
}
