import { HorizontalFormControl } from "@langwatch/design-system/horizontal-form-control";
import { Button, HStack, Spinner, Text, VStack } from "@langwatch/design-system/primitives";
import { Mail } from "lucide-react";
import { useEffect } from "react";
import {
  type Control,
  Controller,
  type FieldErrors,
  type SubmitHandler,
  useForm,
  useWatch,
} from "react-hook-form";

import { useTeamsFollowSeat } from "../../behavior/use-teams-follow-seat.ts";
import {
  INVITE_SEATS,
  type InviteFormValues,
  invitesFromForm,
  type TeamOption,
  validateInviteEmails,
} from "../../model/add-members-form-model.ts";
import type { MembersForm } from "../../model/member-invite-form.ts";
import { OrganizationUserRole, TeamUserRole } from "../../model/prisma-types.ts";
import { InviteEmailChips } from "../elements/invite-email-chips.tsx";
import { OrganizationUserRoleField } from "../elements/organization-user-role-field.tsx";
import { InviteTeamAssignments } from "./invite-team-assignments.tsx";

interface AddMembersFormProps {
  teamOptions: TeamOption[];
  organizationId: string;
  onSubmit: SubmitHandler<MembersForm>;
  isLoading?: boolean;
  hasEmailProvider?: boolean;
  onClose?: () => void;
  onCloseText?: string;
  isInviterAdmin?: boolean;
  /**
   * Seed the email field — used when the drawer is opened from the inline invite
   * box, so what the user typed there carries into the form instead of being
   * retyped.
   */
  initialEmails?: string;
}

export function AddMembersForm({
  teamOptions,
  organizationId,
  onSubmit,
  isLoading = false,
  hasEmailProvider = false,
  onClose,
  onCloseText = "Cancel",
  isInviterAdmin = true,
  initialEmails = "",
}: AddMembersFormProps) {
  const firstTeamId = teamOptions[0]?.value;
  const {
    control,
    handleSubmit,
    setValue,
    setFocus,
    formState: { errors },
  } = useForm<InviteFormValues>({
    defaultValues: {
      emailsRaw: initialEmails,
      orgRole: OrganizationUserRole.MEMBER,
      teams: firstTeamId !== undefined ? [{ teamId: firstTeamId, role: TeamUserRole.MEMBER }] : [],
    },
  });

  // Opened from the inline invite box: typing carries on here, not in the box behind.
  useEffect(() => {
    if (initialEmails) setFocus("emailsRaw");
  }, [initialEmails, setFocus]);

  const selectedTeams = useWatch({ control, name: "teams" });
  const orgRole = useWatch({ control, name: "orgRole" });
  useTeamsFollowSeat({ orgRole, selectedTeams, setValue });

  return (
    <form onSubmit={handleSubmit((values) => onSubmit({ invites: invitesFromForm(values) }))}>
      <VStack align="start" gap={4} width="100%">
        <VStack width="full" gap={0}>
          <InviteEmailsField control={control} errors={errors} />
          <InviteSeatField control={control} />
        </VStack>
        <InviteTeamAssignments
          control={control}
          setValue={setValue}
          teamOptions={teamOptions}
          orgRole={orgRole}
          organizationId={organizationId}
          isInviterAdmin={isInviterAdmin}
        />
        <InviteFormActions
          isLoading={isLoading}
          hasEmailProvider={hasEmailProvider}
          onClose={onClose}
          onCloseText={onCloseText}
        />
      </VStack>
    </form>
  );
}

function InviteEmailsField({
  control,
  errors,
}: {
  control: Control<InviteFormValues>;
  errors: FieldErrors<InviteFormValues>;
}) {
  return (
    <HorizontalFormControl
      label="Email addresses"
      helper="Type or paste addresses; a comma, space or Enter adds each one"
      invalid={!!errors.emailsRaw}
      error={errors.emailsRaw}
      inputWidth="60%"
    >
      <Controller
        control={control}
        name="emailsRaw"
        rules={{ required: "At least one email is required", validate: validateInviteEmails }}
        render={({ field }) => (
          <InviteEmailChips
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            inputRef={field.ref}
            invalid={!!errors.emailsRaw}
          />
        )}
      />
    </HorizontalFormControl>
  );
}

function InviteSeatField({ control }: { control: Control<InviteFormValues> }) {
  return (
    <HorizontalFormControl
      label="Seat"
      helper="What they can do across the organization"
      inputWidth="60%"
    >
      <Controller
        control={control}
        name="orgRole"
        render={({ field }) => (
          <OrganizationUserRoleField
            value={field.value}
            onChange={field.onChange}
            roles={INVITE_SEATS}
            width="full"
            ariaLabel="Seat"
          />
        )}
      />
    </HorizontalFormControl>
  );
}

function InviteFormActions({
  isLoading,
  hasEmailProvider,
  onClose,
  onCloseText,
}: {
  isLoading: boolean;
  hasEmailProvider: boolean;
  onClose?: () => void;
  onCloseText: string;
}) {
  return (
    <HStack justify="end" width="100%" marginTop={2}>
      <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
        {onCloseText}
      </Button>
      <Button
        colorPalette={isLoading ? "gray" : "orange"}
        type="submit"
        disabled={isLoading}
        data-testid="members-invite-submit"
      >
        <HStack>
          {isLoading ? <Spinner size="sm" /> : <Mail size={18} />}
          <Text>{hasEmailProvider ? "Send invites" : "Create invites"}</Text>
        </HStack>
      </Button>
    </HStack>
  );
}
