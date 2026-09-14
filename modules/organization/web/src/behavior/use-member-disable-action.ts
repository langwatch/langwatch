import { api } from "./organization-api.ts";
import { useOrganizationToaster, useShowErrorToast } from "./organization-feedback.ts";

/** Disable/re-enable reconciles organization seats with license; refusal opens limit modal. */
export function useMemberDisableAction({
  organizationId,
  onChanged,
}: {
  organizationId: string;
  onChanged: () => void;
}) {
  const toaster = useOrganizationToaster();
  const showErrorToast = useShowErrorToast();
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

  return { setMemberDisabled, isSettingDisabled: mutation.isPending };
}
