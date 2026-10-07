/** Organization's drawers and the cards it lends, by token (ARCHITECTURE.md §10.1). */

import { uiTokens } from "@langwatch/module";
import type {
  UiCreateProjectDrawerProps,
  UiCreateTeamDrawerProps,
  UiEditProjectDrawerProps,
  UiInviteMemberDrawerProps,
  UiPersonDrawerProps,
} from "@langwatch/organization-contract";
import type { ReactNode } from "react";

/**
 * What a screen hands the join offer. A string scopes to that organization, `null` means
 * no organization context (onboarding), `undefined` means it is still loading.
 */
export type JoinOfferProps = {
  currentOrganizationId: string | null | undefined;
  /** The way past, where "keep working on my own" is not what declining means. */
  dismissLabel?: string;
  onDismissed?: () => void;
  /** A lower-priority prompt, shown only once the join decision resolves to nothing. */
  fallback?: ReactNode;
  /** Where a request made from here comes from (ADR-171 v6); `cli` lands a Developer seat. */
  origin?: "web" | "cli";
};

/** What project's settings form hands organization's lent department row. */
export type ProjectDepartmentFieldProps = {
  organizationId: string;
  projectId: string;
  governanceEnabled: boolean;
};

/** The card of people waiting to join needs nothing handed in: it reads scope. */
export type PendingJoinRequestsProps = Record<string, never>;

const organization = uiTokens("organization");

export const CreateProjectDrawerToken =
  organization.drawer<UiCreateProjectDrawerProps>("createProject");
export const EditProjectDrawerToken = organization.drawer<UiEditProjectDrawerProps>("editProject");
export const CreateTeamDrawerToken = organization.drawer<UiCreateTeamDrawerProps>("createTeam");
export const InviteMemberDrawerToken =
  organization.drawer<UiInviteMemberDrawerProps>("inviteMember");
export const PersonDrawerToken = organization.drawer<UiPersonDrawerProps>("person");
export const JoinOfferToken = organization.component<JoinOfferProps>("joinOffer");
export const ProjectDepartmentFieldToken =
  organization.component<ProjectDepartmentFieldProps>("projectDepartmentField");
export const PendingJoinRequestsToken =
  organization.component<PendingJoinRequestsProps>("pendingJoinRequests");
