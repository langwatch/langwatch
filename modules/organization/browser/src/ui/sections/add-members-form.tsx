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
  splitInviteEmails,
  type TeamOption,
  validateInviteEmails,
} from "../../model/add-members-form-model.ts";
import { type FreePlanInvite, freePlanSeatDescriptions } from "../../model/free-plan-invite.ts";
import {
  BILLING_ONLY_SEAT,
  type InviteSeat,
  type MembersForm,
} from "../../model/member-invite-form.ts";
import { OrganizationUserRole, TeamUserRole } from "../../model/prisma-types.ts";
import { InviteEmailChips } from "../elements/invite-email-chips.tsx";
import { LiteNotOnFreeNotice } from "../elements/lite-not-on-free-notice.tsx";
import { OrganizationUserRoleField } from "../elements/organization-user-role-field.tsx";
import { InviteTeamAssignments } from "./invite-team-assignments.tsx";

interface AddMembersFormProps {
  /** Set when the host draws the actions (a drawer footer) and submits this form by id. */
  formId?: string;
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
  /** The choice the form opens with; the limit dialog opens it on Billing only. */
  initialSeat?: InviteSeat;
  /** Set on Free, where Lite is not sold: the picker says so and offers Billing only. */
  freePlan?: FreePlanInvite & { onUpgrade: () => void };
  /** Told each time the seat changes, so the host can hold its own send button. */
  onSeatChange?: (seat: InviteSeat) => void;
}

export function AddMembersForm({
  formId,
  teamOptions,
  organizationId,
  onSubmit,
  isLoading = false,
  hasEmailProvider = false,
  onClose,
  onCloseText = "Cancel",
  isInviterAdmin = true,
  initialEmails = "",
  initialSeat = OrganizationUserRole.MEMBER,
  freePlan,
  onSeatChange,
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
      orgRole: initialSeat,
      teams:
        firstTeamId !== undefined && initialSeat === OrganizationUserRole.MEMBER
          ? [{ teamId: firstTeamId, role: TeamUserRole.MEMBER }]
          : [],
    },
  });

  // Opened from the inline invite box: typing carries on here, not in the box behind.
  useEffect(() => {
    if (initialEmails) setFocus("emailsRaw");
  }, [initialEmails, setFocus]);

  const selectedTeams = useWatch({ control, name: "teams" });
  const orgRole = useWatch({ control, name: "orgRole" });
  const emailsRaw = useWatch({ control, name: "emailsRaw" });
  useTeamsFollowSeat({ orgRole, selectedTeams, setValue });
  useEffect(() => {
    onSeatChange?.(orgRole);
  }, [orgRole, onSeatChange]);

  const submit = handleSubmit((values) => onSubmit({ invites: invitesFromForm(values) }));
  const inviteAsBillingOnly = () => {
    setValue("orgRole", BILLING_ONLY_SEAT);
    void submit();
  };

  return (
    <form id={formId} onSubmit={submit}>
      <VStack align="start" gap={4} width="100%">
        <VStack width="full" gap={0}>
          <InviteEmailsField control={control} errors={errors} />
          <InviteSeatField
            control={control}
            {...(freePlan ? { descriptions: freePlanSeatDescriptions(freePlan) } : {})}
          />
        </VStack>
        {freePlan && orgRole === OrganizationUserRole.EXTERNAL && (
          <LiteNotOnFreeNotice
            emails={splitInviteEmails(emailsRaw)}
            organizationName={freePlan.organizationName}
            growthSeatPrice={freePlan.growthSeatPrice}
            onInviteBillingOnly={inviteAsBillingOnly}
            onUpgrade={freePlan.onUpgrade}
            busy={isLoading}
          />
        )}
        <InviteTeamAssignments
          control={control}
          setValue={setValue}
          teamOptions={teamOptions}
          orgRole={orgRole}
          organizationId={organizationId}
          isInviterAdmin={isInviterAdmin}
        />
        {formId === undefined && (
          <InviteFormActions
            isLoading={isLoading}
            hasEmailProvider={hasEmailProvider}
            onClose={onClose}
            onCloseText={onCloseText}
          />
        )}
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

function InviteSeatField({
  control,
  descriptions,
}: {
  control: Control<InviteFormValues>;
  descriptions?: Partial<Record<InviteSeat, string>>;
}) {
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
            descriptions={descriptions}
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
