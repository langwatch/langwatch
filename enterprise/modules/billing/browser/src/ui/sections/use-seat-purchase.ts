/**
 * What the Manage seats drawer does once the administrator confirms: invite into seats already
 * held, or change the Growth subscription in place and then invite.
 * @see specs/licensing/seat-buying.feature
 */
import { billingApi } from "../../behavior/billing-api.ts";
import { type BillingHostApi, useBillingHost } from "../../model/billing-host.ts";
import { OrganizationUserRole, TeamUserRole } from "../../model/prisma-types.ts";
import { joinEmails } from "../../model/seat-purchase.ts";

/** A confirmed Growth change: full seats, Developer seats, and who to invite after. */
export type SeatCommit = {
  seats: number | undefined;
  quotedAt: number | undefined;
  developer: { quantity: number; quotedAt: number | undefined } | undefined;
  emails: string[];
  successTitle: string;
};

/** How a commit ended: all done, refused before anything changed, or changed but not invited. */
export type SeatCommitOutcome = "committed" | "refused" | "notInvited";

type CreateInvites = (input: {
  organizationId: string;
  invites: {
    email: string;
    role: OrganizationUserRole;
    teams?: { teamId: string; role: TeamUserRole }[];
  }[];
}) => Promise<unknown>;

type SetDeveloperSeats = (input: {
  organizationId: string;
  quantity: number;
  quotedAt?: number;
}) => Promise<unknown>;

/** Sends the invitations; a refusal or an empty answer is reported and answers false. */
async function sendInvites({
  host,
  createInvites,
  organizationId,
  activeTeamId,
  emails,
}: {
  host: BillingHostApi;
  createInvites: CreateInvites;
  organizationId: string;
  activeTeamId: string | undefined;
  emails: string[];
}): Promise<boolean> {
  if (emails.length === 0) return true;
  const teams = activeTeamId
    ? { teams: [{ teamId: activeTeamId, role: TeamUserRole.MEMBER }] }
    : {};
  try {
    const created = await createInvites({
      organizationId,
      invites: emails.map((email) => ({
        email: email.toLowerCase(),
        role: OrganizationUserRole.MEMBER,
        ...teams,
      })),
    });
    if (Array.isArray(created) && created.length > 0) return true;
    host.failed({
      error: void 0,
      fallbackTitle: "No invitations were sent",
      description: "None of these addresses could be invited. Check them and try again.",
    });
    return false;
  } catch (error) {
    host.failed({ error, fallbackTitle: "Couldn't send invites" });
    return false;
  }
}

/** Changes the Developer seats; a refusal is reported and answers false. */
async function changeDeveloperSeats({
  host,
  setDeveloperSeats,
  organizationId,
  developer,
}: {
  host: BillingHostApi;
  setDeveloperSeats: SetDeveloperSeats;
  organizationId: string;
  developer: NonNullable<SeatCommit["developer"]>;
}): Promise<boolean> {
  try {
    await setDeveloperSeats({
      organizationId,
      quantity: developer.quantity,
      ...(developer.quotedAt === undefined ? {} : { quotedAt: developer.quotedAt }),
    });
    return true;
  } catch (error) {
    host.failed({ error, fallbackTitle: "Couldn't update your developer seats" });
    return false;
  }
}

/** The full seats first, then Developer seats, then the invites; stops at the first refusal. */
async function commitChange({
  host,
  change,
  commitSeats,
  setDeveloperSeats,
  send,
  organizationId,
  onChanged,
}: {
  host: BillingHostApi;
  change: SeatCommit;
  commitSeats: (input: { newSeats: number; quotedAt: number | undefined }) => Promise<boolean>;
  setDeveloperSeats: SetDeveloperSeats;
  send: (emails: string[]) => Promise<boolean>;
  organizationId: string;
  onChanged: () => void;
}): Promise<SeatCommitOutcome> {
  const seatsChanged =
    change.seats === undefined ||
    (await commitSeats({ newSeats: change.seats, quotedAt: change.quotedAt }));
  if (!seatsChanged) return "refused";
  const developerChanged =
    change.developer === undefined ||
    (await changeDeveloperSeats({
      host,
      setDeveloperSeats,
      organizationId,
      developer: change.developer,
    }));
  if (!developerChanged) {
    onChanged();
    return "refused";
  }
  const invited = await send(change.emails);
  onChanged();
  if (!invited) return "notInvited";
  host.succeeded({ title: change.successTitle });
  return "committed";
}

export function useSeatPurchase({
  organizationId,
  activeTeamId,
  commitSeats,
  onChanged,
}: {
  organizationId: string | undefined;
  activeTeamId: string | undefined;
  /** Changes the full seats; a failure was already reported and answers false. */
  commitSeats: (input: { newSeats: number; quotedAt: number | undefined }) => Promise<boolean>;
  onChanged: () => void;
}) {
  const host = useBillingHost();
  const createInvites = billingApi.invite.createInvites.useMutation();
  const setDeveloperSeats = billingApi.subscription.setDeveloperSeats.useMutation();

  const send = (orgId: string, emails: string[]) =>
    sendInvites({
      host,
      createInvites: createInvites.mutateAsync,
      organizationId: orgId,
      activeTeamId,
      emails,
    });

  /** Invites into seats the plan already covers. */
  const invite = async (emails: string[]): Promise<boolean> => {
    if (!organizationId || !(await send(organizationId, emails))) return false;
    host.succeeded({
      title: `${emails.length === 1 ? "Invite" : "Invites"} sent to ${joinEmails(emails)}.`,
    });
    onChanged();
    return true;
  };

  const commit = (change: SeatCommit): Promise<SeatCommitOutcome> =>
    organizationId
      ? commitChange({
          host,
          change,
          commitSeats,
          setDeveloperSeats: setDeveloperSeats.mutateAsync,
          send: (emails) => send(organizationId, emails),
          organizationId,
          onChanged,
        })
      : Promise.resolve("refused");

  return {
    invite,
    commit,
    isWorking: createInvites.isPending || setDeveloperSeats.isPending,
  };
}
