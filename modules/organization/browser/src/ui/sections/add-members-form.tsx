import {
  Button,
  Field,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Mail } from "lucide-react";
import {
  type Control,
  Controller,
  type FieldErrors,
  type SubmitHandler,
  type UseFormRegister,
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
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<InviteFormValues>({
    defaultValues: {
      emailsRaw: initialEmails,
      orgRole: OrganizationUserRole.MEMBER,
      teams: firstTeamId !== undefined ? [{ teamId: firstTeamId, role: TeamUserRole.MEMBER }] : [],
    },
  });

  const selectedTeams = useWatch({ control, name: "teams" });
  const orgRole = useWatch({ control, name: "orgRole" });
  useTeamsFollowSeat({ orgRole, selectedTeams, setValue });

  return (
    <form onSubmit={handleSubmit((values) => onSubmit({ invites: invitesFromForm(values) }))}>
      <VStack align="start" gap={4} width="100%">
        <HStack gap={4} align="start" width="full">
          <InviteEmailsField register={register} errors={errors} />
          <InviteSeatField control={control} />
        </HStack>
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
  register,
  errors,
}: {
  register: UseFormRegister<InviteFormValues>;
  errors: FieldErrors<InviteFormValues>;
}) {
  return (
    <Field.Root flex="2" invalid={!!errors.emailsRaw}>
      <Field.Label>Email addresses</Field.Label>
      <Input
        placeholder="alice@example.com, bob@example.com"
        data-testid="members-invite-emails"
        {...register("emailsRaw", {
          required: "At least one email is required",
          validate: validateInviteEmails,
        })}
      />
      <Field.ErrorText>{errors.emailsRaw?.message}</Field.ErrorText>
    </Field.Root>
  );
}

function InviteSeatField({ control }: { control: Control<InviteFormValues> }) {
  return (
    <Field.Root flex="1">
      <Field.Label>Seat</Field.Label>
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
    </Field.Root>
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
    <HStack justify="end" width="100%" marginTop={4}>
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
