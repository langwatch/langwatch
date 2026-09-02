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
  type NavigationDeployment,
  type NavigationFlagReading,
  type NavigationLangy,
  type NavigationCommandBar,
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
  /** The search palette this application mounts, or nothing when it has none. */
  commandBar: NavigationCommandBar | null;
  /** The assistant, or nothing when this reader may not start a turn with it. */
  langy: NavigationLangy | null;
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
  openDrawer: (drawer: string, params?: Record<string, string>) => void;
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
   * THE SEARCH PALETTE, ANSWERED FOR REAL. The shell's two entries — the
   * sidebar's Quick Search row and the header's trigger — read this, and both
   * light up because `features/chrome` mounts `CommandBarProvider` inside the
   * host it builds here.
   *
   * The answer is `null` before that provider has mounted, which is the same
   * honest answer this returned while the palette was still in `platform/app`:
   * no row, no trigger, rather than a control that opens nothing.
   */
  commandBar(): NavigationCommandBar | null {
    return this.readings.commandBar;
  }

  /**
   * Opens a drawer by name against this application's composed registry.
   *
   * The command catalogue names eight other families' drawers. None of them is
   * the navigation package's to import and none has to be: the catalogue
   * carries the name, `installed-ui-drawers` carries the components, and this
   * is where the two meet.
   */
  openDrawer(drawer: string, params?: Record<string, string>): void {
    this.actions.openDrawer(drawer, params);
  }

  /**
   * The assistant, when this reader may start a turn with it.
   *
   * `null` is the gate rather than a flag the palette reads for itself: a
   * reader holding only `langy:view` is never offered the hand-off, because
   * the hand-off queues a prompt that auto-sends and would come back 403.
   */
  langy(): NavigationLangy | null {
    return this.readings.langy;
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
