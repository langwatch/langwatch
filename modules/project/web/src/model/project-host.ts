/**
 * What the project-settings screen asks of the application it is mounted in.
 * Answers both organization and project; the screen decides which forms to render.
 */

import { createContext, useContext, type ReactNode } from "react";

import type { OrganizationIntent } from "./prisma-types.ts";

/**
 * The organization this page edits; fields match the form's inputs.
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
  teams: { id: string; name: string; slug: string; isPersonal: boolean }[];
};

/**
 * The project this page edits. `isPersonal` and `firstMessage` are not
 * settings — a personal workspace is never offered as the organization's
 * project, and a project with no data is what the LLMOps hand-off sets up.
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
 * A failure, as the screen knows it. The raw `error` travels, never a
 * composed sentence — customer words are resolved from `code` by the
 * host's presentation registry (#5984).
 */
export type ProjectFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  description?: string;
};

export abstract class ProjectHostApi {
  abstract organization(): ProjectHostOrganization | undefined;

  /** The project in scope, or undefined when the address names none. */
  abstract project(): ProjectHostProject | undefined;

  abstract hasPermission(permission: string): boolean;

  /**
   * Whether the reader holds the lite `EXTERNAL` membership role — a column
   * rather than a grant, so `hasPermission` cannot answer it; decides which
   * settings show read-only rather than hidden.
   */
  abstract isLiteMember(): boolean;

  /** Whether a feature flag is on. Fail-closed while it is still arriving. */
  abstract isFeatureEnabled(flag: string): boolean;

  /**
   * The application's project switcher, or null where none is mounted. The
   * platform page puts `DashboardLayout`'s selector in its header — chrome
   * belongs to the route tree, so it is handed in, same as the audit-log screen.
   */
  abstract projectSwitcher(): ReactNode | null;

  /** Opens one of the application's overlays, by the name its address uses. */
  abstract openOverlay(name: string, props?: Record<string, unknown>): void;

  abstract succeeded(notice: ProjectSuccessNotice): void;

  abstract failed(failure: ProjectFailureNotice): void;
}

const ProjectHostContext = createContext<ProjectHostApi | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const ProjectHostProvider = ProjectHostContext.Provider;

/**
 * The host this screen is mounted in. Missing means the screen rendered
 * outside the frontend feature that owns it — a composition fault, not
 * something a screen can degrade around.
 */
export function useProjectHost(): ProjectHostApi {
  const host = useContext(ProjectHostContext);
  if (!host) {
    throw new Error(
      "No project host is mounted above this screen; render it inside the project frontend feature.",
    );
  }
  return host;
}
