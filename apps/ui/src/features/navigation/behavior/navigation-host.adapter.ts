/**
 * The navigation package's host port, answered from this application.
 *
 * `@langwatch/navigation-web` declares what the landing redirect and the project
 * switcher need — the workspace graph, the signed-in reader, one grant check,
 * two feature flags, this device's scope memory, and the two navigations — as
 * one abstract class it can define without importing anything of ours. This is
 * the other half: a plain adapter over what the application shell has already
 * resolved.
 *
 * Nothing here fetches. The values arrive as arguments, so the adapter is a
 * value object a test can construct, and the reads that produce them stay in the
 * one component that mounts it.
 */

import {
  NavigationHostPort,
  type LastVisitedHomeKind,
  type NavigationAccountMenu,
  type NavigationCommandBar,
  type NavigationDeployment,
  type NavigationFlagReading,
  type NavigationOpsAccess,
  type NavigationOrganization,
  type NavigationPlanReading,
  type NavigationProject,
  type NavigationScopeWrite,
  type NavigationSupportChat,
  type NavigationTeam,
  type NavigationUser,
} from "@langwatch/navigation-web/screens/landing";
import type { ReactNode } from "react";

export type NavigationHostReadings = {
  organizations: NavigationOrganization[];
  organization: NavigationOrganization | undefined;
  project: NavigationProject | undefined;
  team: NavigationTeam | undefined;
  openableTeams: readonly NavigationTeam[];
  isLoading: boolean;
  currentUser: NavigationUser | undefined;
  organizationRole: string | undefined;
  rememberedProjectSlug: string;
  lastVisitedHomeKind: LastVisitedHomeKind;
  waiting: ReactNode;
  notFound: ReactNode;
  pathname: string;
  search: string;
  projectParam: string | undefined;
  catchAllPath: string;
  deployment: NavigationDeployment;
  plan: NavigationPlanReading;
  opsAccess: NavigationOpsAccess;
};

export type NavigationHostActions = {
  hasPermission: (permission: string) => boolean;
  featureFlag: (flag: string) => NavigationFlagReading;
  replace: (to: string) => void;
  navigate: (to: string) => void;
  back: () => void;
  rememberScope: (write: NavigationScopeWrite) => void;
  signOut: () => void;
  setDocumentTitle: (title: string) => () => void;
};

export class UiNavigationHost extends NavigationHostPort {
  static create(
    readings: NavigationHostReadings,
    actions: NavigationHostActions,
  ): UiNavigationHost {
    return new UiNavigationHost(readings, actions);
  }

  private constructor(
    private readonly readings: NavigationHostReadings,
    private readonly actions: NavigationHostActions,
  ) {
    super();
  }

  organizations(): NavigationOrganization[] {
    return this.readings.organizations;
  }

  organization(): NavigationOrganization | undefined {
    return this.readings.organization;
  }

  project(): NavigationProject | undefined {
    return this.readings.project;
  }

  openableTeams(): readonly NavigationTeam[] {
    return this.readings.openableTeams;
  }

  isLoading(): boolean {
    return this.readings.isLoading;
  }

  currentUser(): NavigationUser | undefined {
    return this.readings.currentUser;
  }

  team(): NavigationTeam | undefined {
    return this.readings.team;
  }

  organizationRole(): string | undefined {
    return this.readings.organizationRole;
  }

  rememberedProjectSlug(): string {
    return this.readings.rememberedProjectSlug;
  }

  lastVisitedHomeKind(): LastVisitedHomeKind {
    return this.readings.lastVisitedHomeKind;
  }

  hasPermission(permission: string): boolean {
    return this.actions.hasPermission(permission);
  }

  /**
   * The tri-state the session capability keeps, narrowed to the two fields the
   * navigation package reads. `undefined` there means "not answered yet", which
   * is what stops a landing decision resolving against a flag still in flight.
   */
  featureFlag(flag: string): NavigationFlagReading {
    return this.actions.featureFlag(flag);
  }

  waiting(): ReactNode {
    return this.readings.waiting;
  }

  replace(to: string): void {
    this.actions.replace(to);
  }

  navigate(to: string): void {
    this.actions.navigate(to);
  }

  back(): void {
    this.actions.back();
  }

  pathname(): string {
    return this.readings.pathname;
  }

  search(): string {
    return this.readings.search;
  }

  projectParam(): string | undefined {
    return this.readings.projectParam;
  }

  catchAllPath(): string {
    return this.readings.catchAllPath;
  }

  deployment(): NavigationDeployment {
    return this.readings.deployment;
  }

  plan(): NavigationPlanReading {
    return this.readings.plan;
  }

  opsAccess(): NavigationOpsAccess {
    return this.readings.opsAccess;
  }

  notFound(): ReactNode {
    return this.readings.notFound;
  }

  rememberScope(write: NavigationScopeWrite): void {
    this.actions.rememberScope(write);
  }

  signOut(): void {
    this.actions.signOut();
  }

  setDocumentTitle(title: string): () => void {
    return this.actions.setDocumentTitle(title);
  }

  /**
   * NO SEARCH PALETTE ON THIS SIDE, and the answer is `null` rather than a
   * control that opens nothing.
   *
   * `platform/app/src/features/command-bar` is thirty-three modules with a
   * command catalogue of its own, five procedures, a Langy handoff and a
   * drawer preloader — a family-sized move, and still MOUNTED over there, so
   * the deletes-only rule does not reach it. The shell's two entries (the
   * Quick Search row and the header trigger) light up the day a host answers
   * this with one.
   */
  commandBar(): NavigationCommandBar | null {
    return null;
  }

  /**
   * NO LIVE-CHAT BUBBLE. The Crisp script is loaded by `platform/app`, and
   * this application does not carry it, so the Support menu offers the
   * community and documentation entries and no "Chat with a human".
   */
  supportChat(): NavigationSupportChat | null {
    return null;
  }

  /**
   * NOTHING ADDED TO THE ACCOUNT DROPDOWN YET.
   *
   * The three things the platform menu put there are all other halves'
   * property: the experiments dialog is `@langwatch/feature-flag-web`, the
   * impersonation banner and switch-back entry are `@langwatch/ops-web`, and
   * the reduced-graphics override is a `platform/app` store. Each becomes a
   * node here when its family is composed on this side.
   */
  accountMenu(): NavigationAccountMenu | null {
    return null;
  }
}
