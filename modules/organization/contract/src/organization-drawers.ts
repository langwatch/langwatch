/** What a caller hands organization's drawers; the tokens live in organization-client (§10.1). */

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
