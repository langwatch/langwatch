/**
 * What the project-settings screen asks of the application it is mounted in.
 *
 * ONE PORT FOR ONE ADDRESS that edits TWO things — the organization and the
 * project inside it — which is why the port answers both and the screen decides
 * which forms to render. Everything the platform page read off
 * `useOrganizationTeamProject`, `useLiteMemberGuard`, `useFeatureFlag`,
 * `useDrawer` and the toaster arrives through these methods.
 */

import { createContext, useContext, type ReactNode } from "react";

import type { OrganizationIntent } from "./prisma-types";

/**
 * The organization this page edits.
 *
 * The fields are exactly the form's: the name, the four object-storage
 * settings, the two per-organization switches, the support contact and the
 * primary use that decides where `/` lands. `platform/app` typed this
 * `FullyLoadedOrganization`, a Prisma row shape from a server repository, and
 * a browser package may not name one.
 */
export type ProjectHostOrganization = {
  id: string;
  name: string;
  slug: string;
  /** Whether the organization brings its own object store rather than ours. */
  useCustomS3: boolean;
  s3Endpoint: string | null;
  s3AccessKeyId: string | null;
  s3SecretAccessKey: string | null;
  s3Bucket: string | null;
  presenceEnabled: boolean;
  traceSharingEnabled: boolean;
  supportContact: string | null;
  primaryIntent: OrganizationIntent | null;
  /**
   * The teams under it, which the LLMOps hand-off needs to name a home for a
   * project it is about to create.
   */
  teams: Array<{ id: string; name: string; slug: string; isPersonal: boolean }>;
};

/**
 * The project this page edits.
 *
 * `isPersonal` and `firstMessage` are not settings — they are what the page
 * decides with. A personal workspace is never offered as the organization's
 * project, and a project that has never received data is what the LLMOps
 * hand-off offers to set up.
 */
export type ProjectHostProject = {
  id: string;
  name: string;
  slug: string;
  language: string;
  framework: string;
  userLinkTemplate: string | null;
  s3Endpoint: string | null;
  s3AccessKeyId: string | null;
  s3SecretAccessKey: string | null;
  s3Bucket: string | null;
  traceSharingEnabled: boolean;
  presenceEnabled: boolean;
  isPersonal: boolean;
  firstMessage: boolean;
};

export type ProjectSuccessNotice = {
  title: string;
  description?: string;
};

/**
 * A failure, as the screen knows it.
 *
 * The raw `error` travels, never a sentence the screen composed: the words a
 * customer reads are resolved from the error's `code` by the host's
 * presentation registry (#5984).
 */
export type ProjectFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  description?: string;
};

export abstract class ProjectHostPort {
  abstract organization(): ProjectHostOrganization | undefined;

  /** The project in scope, or undefined when the address names none. */
  abstract project(): ProjectHostProject | undefined;

  abstract hasPermission(permission: string): boolean;

  /**
   * Whether the reader holds the lite `EXTERNAL` membership role.
   *
   * A membership column rather than a grant, so `hasPermission` cannot answer
   * it; it decides which settings are shown as read-only rather than hidden.
   */
  abstract isLiteMember(): boolean;

  /** Whether a feature flag is on. Fail-closed while it is still arriving. */
  abstract isFeatureEnabled(flag: string): boolean;

  /**
   * The application's project switcher, or null where none is mounted.
   *
   * The platform page put `DashboardLayout`'s selector in its header; chrome
   * belongs to the route tree, so the control is handed in rather than
   * imported. The audit-log screen next door takes the same shape.
   */
  abstract projectSwitcher(): ReactNode | null;

  /** Opens one of the application's overlays, by the name its address uses. */
  abstract openOverlay(name: string, props?: Record<string, unknown>): void;

  abstract succeeded(notice: ProjectSuccessNotice): void;

  abstract failed(failure: ProjectFailureNotice): void;
}

const ProjectHostContext = createContext<ProjectHostPort | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const ProjectHostProvider = ProjectHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useProjectHost(): ProjectHostPort {
  const host = useContext(ProjectHostContext);
  if (!host) {
    throw new Error(
      "No project host is mounted above this screen; render it inside the project frontend feature.",
    );
  }
  return host;
}
