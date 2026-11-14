/**
 * One person, opened from the members list as the routed `person` drawer:
 * who they are, what they can reach, and what an administrator can do about it.
 * Impersonation is deliberately absent. Spec: specs/identity/directory-administration.feature
 */

import { Drawer } from "@langwatch/design-system/drawer";
import { Badge, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { SettingsSection } from "@langwatch/design-system/settings-section";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import { Switch } from "@langwatch/design-system/switch";
import type { UiPersonDrawerProps } from "@langwatch/organization-contract";
import { Ban, CreditCard, KeyRound, ShieldCheck, Trash2, Undo2, UserCog } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { HandledErrorAlert } from "../../behavior/handled-error-form.tsx";
import { api, type RouterOutputs } from "../../behavior/organization-api.ts";
import { useOrganizationToaster, useShowErrorToast } from "../../behavior/organization-feedback.ts";
import { useDrawer } from "../../behavior/use-drawer.ts";
import { useMemberDisableAction } from "../../behavior/use-member-disable-action.ts";
import { useMemberProvenance } from "../../behavior/use-member-provenance.ts";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project.ts";
import { useRequiredSession } from "../../behavior/use-required-session.ts";
import { useTwoStepRequirement } from "../../behavior/use-two-step-requirement.ts";
import { useOrganizationHost } from "../../model/organization-host.ts";
import { IdentityChip } from "../elements/identity-row.tsx";
import { ProvenanceChip, ProvenanceExplanation } from "../elements/member-provenance.tsx";
import { SecondFactorCell } from "../elements/second-factor-cell.tsx";
import { MemberAccessEditor } from "./member-access-editor.tsx";
import { PersonIdentityRow } from "./person-identity-row.tsx";
import { RemoveMemberDialog } from "./remove-member-dialog.tsx";

export function PersonDrawer({ open = true, userId }: UiPersonDrawerProps) {
  const { closeDrawer } = useDrawer();
  const { organization } = useOrganizationTeamProject();
  const host = useOrganizationHost();
  const organizationId = organization?.id ?? "";

  return (
    <Drawer open={open} onClose={closeDrawer} title="Person" size="lg">
      {userId && organizationId ? (
        <PersonDetail
          organizationId={organizationId}
          userId={userId}
          canManage={host.hasPermission("organization:manage")}
          onDone={closeDrawer}
        />
      ) : (
        <Text color="fg.muted" fontSize="sm">
          This link does not name anybody. Open a person from the members list.
        </Text>
      )}
    </Drawer>
  );
}

function PersonDetail({
  organizationId,
  userId,
  canManage,
  onDone,
}: {
  organizationId: string;
  userId: string;
  canManage: boolean;
  onDone: () => void;
}) {
  const { data: session } = useRequiredSession();
  const isSelf = session?.user.id === userId;
  const member = api.organization.getMemberById.useQuery(
    { organizationId, userId },
    { enabled: canManage },
  );
  const provenance = useMemberProvenance({ organizationId, enabled: canManage });
  const twoStep = useTwoStepRequirement({ organizationId, canManage });
  const billingMembers = api.authz.listBillingMembers.useQuery(
    { organizationId },
    { enabled: canManage },
  );
  const holdsBilling = !!billingMembers.data?.some((holder) => holder.userId === userId);

  if (!canManage) {
    return (
      <Text color="fg.muted" fontSize="sm">
        You need permission to manage this organization to open a member.
      </Text>
    );
  }
  if (member.isError) {
    return <HandledErrorAlert error={member.error} fallbackTitle="Couldn't open this person" />;
  }
  const person = member.data;
  if (!person) return <SkeletonRows rows={2} />;
  const disabled = !!person.disabledAt;

  return (
    <VStack align="stretch" gap={6}>
      <PersonIdentityRow
        name={person.user.name}
        address={person.user.email}
        image={person.user.image}
        badges={
          <>
            {person.role === "EXTERNAL" ? (
              <Badge colorPalette="gray" size="sm">
                Lite Member
              </Badge>
            ) : null}
            {person.role === "DEVELOPER" ? (
              <Badge colorPalette="teal" size="sm">
                Developer
              </Badge>
            ) : null}
            {holdsBilling ? (
              <Badge colorPalette="purple" size="sm" data-testid="person-billing-badge">
                Billing
              </Badge>
            ) : null}
            {person.user.deactivatedAt ? (
              <Badge colorPalette="red" size="sm">
                Deactivated
              </Badge>
            ) : null}
            {disabled ? (
              <Badge colorPalette="orange" size="sm">
                Disabled
              </Badge>
            ) : null}
          </>
        }
      />

      <SettingsSection title="How they sign in" icon={<KeyRound size={18} />} divided={false}>
        <VStack align="start" gap={4} width="full">
          <Fact label="Address">
            <HStack gap={2}>
              <Text fontSize="sm">{person.user.email ?? "None on file"}</Text>
              {person.user.email ? (
                <IdentityChip
                  label={person.user.emailVerified ? "Verified" : "Unverified"}
                  tone={person.user.emailVerified ? "good" : "warning"}
                  title={
                    person.user.emailVerified
                      ? "They proved this address."
                      : "They have not proved this address yet, so it cannot be used to join by domain."
                  }
                  data-testid="person-address-state"
                />
              ) : null}
            </HStack>
          </Fact>
          {twoStep.show ? (
            <Fact label="Second factor">
              <SecondFactorCell
                member={twoStep.byUser.get(person.userId)}
                mfaRequired={twoStep.mfaRequired}
              />
            </Fact>
          ) : null}
          <Fact label="Why they are here">
            <ProvenanceChip provenance={provenance.data?.[person.userId]} />
            {provenance.isError ? (
              <Text fontSize="sm" color="fg.muted">
                We couldn&apos;t work that out just now.
              </Text>
            ) : (
              <ProvenanceExplanation provenance={provenance.data?.[person.userId]} />
            )}
          </Fact>
        </VStack>
      </SettingsSection>

      <SettingsSection title="What they can reach" icon={<ShieldCheck size={18} />} divided={false}>
        <MemberAccessEditor
          organizationId={organizationId}
          userId={person.userId}
          memberRole={person.role}
          canManage={canManage}
          isCurrentUser={isSelf}
        />
      </SettingsSection>

      <BillingRoleSection
        organizationId={organizationId}
        userId={person.userId}
        holdsBilling={holdsBilling}
        loading={billingMembers.isLoading}
      />

      {isSelf ? null : (
        <PersonActions
          organizationId={organizationId}
          person={person}
          disabled={disabled}
          onDone={onDone}
        />
      )}
    </VStack>
  );
}

/** Billing sits beside any other role and takes no seat; only an administrator toggles it. */
function BillingRoleSection({
  organizationId,
  userId,
  holdsBilling,
  loading,
}: {
  organizationId: string;
  userId: string;
  holdsBilling: boolean;
  loading: boolean;
}) {
  const showErrorToast = useShowErrorToast();
  const queryClient = api.useUtils();
  const setBilling = api.authz.setMemberBillingRole.useMutation({
    onSuccess: () => void queryClient.authz.listBillingMembers.invalidate(),
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't change Billing" }),
  });

  return (
    <SettingsSection title="Billing" icon={<CreditCard size={18} />} divided={false}>
      <VStack align="start" gap={2} width="full">
        <Switch
          size="sm"
          data-testid="person-billing-switch"
          checked={holdsBilling}
          disabled={loading || setBilling.isPending}
          inputProps={{ "aria-label": "Billing role" }}
          onCheckedChange={(event) =>
            setBilling.mutate({ organizationId, userId, holds: event.checked === true })
          }
        >
          <Text fontSize="sm">Pays for the organization</Text>
        </Switch>
        <Text fontSize="xs" color="fg.muted">
          Changes the plan and seats, sees invoices, and approves seat requests.
        </Text>
      </VStack>
    </SettingsSection>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <VStack align="start" gap={2} width="full">
      <Text fontSize="sm" fontWeight="medium">
        {label}
      </Text>
      <VStack align="start" gap={2} width="full">
        {children}
      </VStack>
    </VStack>
  );
}

/**
 * Taking a seat away is reversible and comes first; removal ends the membership,
 * so it goes through a dialog naming the person. A confirmation left open never
 * carries over to the next person the drawer is pointed at.
 */
function PersonActions({
  organizationId,
  person,
  disabled,
  onDone,
}: {
  organizationId: string;
  person: RouterOutputs["organization"]["getMemberById"];
  disabled: boolean;
  onDone: () => void;
}) {
  const toaster = useOrganizationToaster();
  const showErrorToast = useShowErrorToast();
  const queryClient = api.useUtils();
  const organizationName = useOrganizationTeamProject().organization?.name;
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  useEffect(() => setConfirmingRemoval(false), [person.userId]);

  const removeMember = api.organization.deleteMember.useMutation();
  const refreshSeats = () => {
    void queryClient.organization.getOrganizationWithMembersAndTheirTeams.invalidate();
    void queryClient.organization.listHeldSeats.invalidate();
    void queryClient.limits.getUsage.invalidate();
    void queryClient.licenseEnforcement.checkLimit.invalidate();
  };
  const { setMemberDisabled, isSettingDisabled } = useMemberDisableAction({
    organizationId,
    onChanged: () => {
      void queryClient.organization.getMemberById.invalidate();
      refreshSeats();
    },
  });

  return (
    <>
      <SettingsSection title="Actions" icon={<UserCog size={18} />} divided={false}>
        <VStack align="start" gap={4} width="full">
          <HStack gap={2} flexWrap="wrap">
            <Button
              size="sm"
              variant="outline"
              loading={isSettingDisabled}
              onClick={() => setMemberDisabled(person.userId, !disabled)}
            >
              {disabled ? <Undo2 size={14} /> : <Ban size={14} />}
              {disabled ? "Give their seat back" : "Take their seat away"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              colorPalette="red"
              onClick={() => setConfirmingRemoval(true)}
            >
              <Trash2 size={14} />
              Remove from organization
            </Button>
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            Taking a seat away is reversible. Removing ends their membership of this organization;
            their account and everything they did stay.
          </Text>
        </VStack>
      </SettingsSection>
      <RemoveMemberDialog
        organizationId={organizationId}
        organizationName={organizationName}
        target={
          confirmingRemoval
            ? {
                userId: person.userId,
                label: person.user.name ?? person.user.email ?? "this member",
              }
            : null
        }
        loading={removeMember.isPending}
        onClose={() => setConfirmingRemoval(false)}
        onConfirm={(removal) =>
          removeMember.mutate(
            { organizationId, ...removal },
            {
              onSuccess: () => {
                toaster.create({
                  title: "Member removed",
                  description: "They no longer have access to this organization.",
                  type: "success",
                  duration: 5000,
                });
                refreshSeats();
                setConfirmingRemoval(false);
                onDone();
              },
              onError: (error) =>
                showErrorToast({ error, fallbackTitle: "Couldn't remove this member" }),
            },
          )
        }
      />
    </>
  );
}
