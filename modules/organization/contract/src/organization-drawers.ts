/** Organization's drawers, by token: the one way a caller opens them (ARCHITECTURE.md §10.1). */

import { uiTokens } from "@langwatch/module";

/** What a caller hands the create-project drawer. */
export type UiCreateProjectDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  navigateOnCreate?: boolean;
  defaultTeamId?: string;
  /** The organization the project lands in, when the reader is standing in another one. */
  organizationId?: string;
  /** Fires on creation, before the drawer closes, with the new project's slug. */
  onCreated?: (result: { projectSlug: string }) => void;
};

/** What a caller hands the edit-project drawer: the project and the team it sits on. */
export type UiEditProjectDrawerProps = {
  open?: boolean;
  projectId?: string;
  projectName?: string;
  currentTeamId?: string;
};

/** What a caller hands the create-team drawer. */
export type UiCreateTeamDrawerProps = {
  open?: boolean;
};

/** What a caller hands the invite drawer: the address to prefill, when it has one. */
export type UiInviteMemberDrawerProps = {
  open?: boolean;
  initialEmail?: string;
};

/** What a caller hands the person drawer: which member to show. */
export type UiPersonDrawerProps = {
  open?: boolean;
  userId?: string;
};

const drawers = uiTokens("organization");

export const CreateProjectDrawerToken = drawers.drawer<UiCreateProjectDrawerProps>("createProject");
export const EditProjectDrawerToken = drawers.drawer<UiEditProjectDrawerProps>("editProject");
export const CreateTeamDrawerToken = drawers.drawer<UiCreateTeamDrawerProps>("createTeam");
export const InviteMemberDrawerToken = drawers.drawer<UiInviteMemberDrawerProps>("inviteMember");
export const PersonDrawerToken = drawers.drawer<UiPersonDrawerProps>("person");
