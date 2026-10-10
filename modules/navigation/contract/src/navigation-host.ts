/** Pure shell shapes of navigation's host port; node-bearing ones derive from the lent port */

/** A project as the switcher and the landing redirect need to know it. */
export type NavigationProject = {
  id: string;
  name: string;
  slug: string;
  /** The project's kind (ADR-177): the switcher marks an aggregate, a landing skips one. */
  kind?: string;
  isPersonal?: boolean | null;
  /** Last coding-agent telemetry timestamp; sessions/PR destinations kept while recent */
  lastCodingAgentSessionAt?: string | null;
  lastCodingAgentPullRequestAt?: string | null;
};

/** A team, with the projects the switcher offers under it. */
export type NavigationTeam = {
  id: string;
  name: string;
  isPersonal?: boolean | null;
  /**
   * Whose personal workspace this is: the shell uses it to tell "my own
   * workspace" from "somebody else's, opened as an administrator".
   */
  ownerUserId?: string | null;
  /** Who may open the team. Absent when the application did not read it. */
  members?: { userId: string }[];
  projects: NavigationProject[];
};

export type NavigationOrganization = {
  id: string;
  name: string;
  /** What the organization declared it is for (ADR-038 v6); null or absent when it has not. */
  primaryIntent?: string | null;
  teams: NavigationTeam[];
};

/**
 * A flag answer, tri-state exactly as the session capability answers it:
 * `isLoading` is what keeps a landing decision from resolving against a flag
 * that has not come back.
 */
export type NavigationFlagReading = {
  enabled: boolean;
  isLoading: boolean;
};

/**
 * The signed-in reader; `impersonator` is set only while an operator views
 * the product as them, and the header tints itself off it.
 */
export type NavigationUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  impersonator?: { id: string; email?: string | null } | null;
};

/** What kind of deployment the chrome is drawn on. */
export type NavigationDeployment = {
  isSaaS: boolean;
  /** Whether ops offers Cloud admin here. */
  hasCloudOps: boolean;
  isDevelopment: boolean;
  /** A development build that asked to draw without the development badge. */
  hideDevIndicator?: boolean;
  /** What the development badge reads instead of "DEV": a haven stack's slug. */
  devIndicatorLabel?: string;
  /** The shared demo project, when this deployment configures one. */
  demoProjectSlug?: string;
  hasNlpService: boolean;
  hasLangevals: boolean;
};

/**
 * The plan the menu's gates read. `isLoading` matters because enterprise
 * entries show while the plan is still arriving, so a reader on that plan
 * never watches links appear a beat after the page.
 */
export type NavigationPlanReading = {
  isEnterprise: boolean;
  isLoading: boolean;
  /** A lite member sees a narrower menu; the guard is the host's. */
  isLiteMember: boolean;
  /**
   * How the organization is priced, in the wire's own spelling: the usage
   * meter compares it against one value, so the port avoids restating a
   * Prisma enum a governed web package may not import.
   */
  pricingModel?: string | null;
};

/** Whether the reader reaches the internal operations pages, and how far. */
export type NavigationOpsAccess = {
  hasAccess: boolean;
  isAdmin: boolean;
};

/** Scope change through host; written to app shell's localStorage, not package's */
export type NavigationScopeWrite = {
  organizationId?: string;
  projectSlug?: string;
};

/** Live-chat bubble when deployment has one; null is real answer, no bubble = no chat entry */
export type NavigationSupportChat = {
  open: () => void;
};
