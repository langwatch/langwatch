/**
 * The shell's answer to navigation's host port — the shell implements a
 * module's `*HostApi` (ARCHITECTURE.md 10.1). Holds the port's shape over the
 * mount's readings, extending the port class the caller hands in.
 */

import type {
  NavigationAccountMenu,
  NavigationCommandBar,
  NavigationDeployment,
  NavigationFlagReading,
  NavigationHost,
  NavigationLangy,
  NavigationOpsAccess,
  NavigationOrganization,
  NavigationPlanReading,
  NavigationProject,
  NavigationScopeWrite,
  NavigationSupportChat,
  NavigationTeam,
  NavigationUser,
} from "@langwatch/navigation-browser/navigation";
import type { ReactNode } from "react";

import { joinOffer, organizationMfaGate, teamAccessWaiting } from "./navigation-host-capabilities";

/** Everything the shell has already read by the time the chrome draws. */
export type BrowserNavigationReading = {
  organizations: NavigationOrganization[];
  organization: NavigationOrganization | undefined;
  team: NavigationTeam | undefined;
  project: NavigationProject | undefined;
  openableTeams: readonly NavigationTeam[];
  isLoading: boolean;
  currentUser: NavigationUser | undefined;
  organizationRole: string | undefined;
  rememberedProjectSlug: string;
  pathname: string;
  search: string;
  projectParam: string | undefined;
  projectSlugFromAddress: string | undefined;
  catchAllPath: string;
  routePattern: string;
  deployment: NavigationDeployment;
  plan: NavigationPlanReading;
  opsAccess: NavigationOpsAccess;
  commandBar: NavigationCommandBar | null;
  langy: NavigationLangy | null;
  accountMenu: NavigationAccountMenu | null;
  waiting: ReactNode;
  notFound: ReactNode;
  hasPermission: (permission: string) => boolean;
  /** Tri-state at the source: `undefined` is "not answered yet". */
  featureFlag: (flag: string) => boolean | undefined;
};

/** Everything the chrome asks the shell to DO. */
export type BrowserNavigationActions = {
  navigate: (to: string) => void;
  replace: (to: string) => void;
  back: () => void;
  rememberScope: (write: NavigationScopeWrite) => void;
  signOut: () => void;
  setDocumentTitle: (title: string) => () => void;
  openDrawer: (drawer: string, params?: Record<string, string>) => void;
};

/** Builds a host over the shell's readings and actions. */
export type BrowserNavigationHosts = {
  create: (reading: BrowserNavigationReading, actions: BrowserNavigationActions) => NavigationHost;
};

/** The shell's host class, over the navigation port class it is handed. */
export function browserNavigationHosts(port: typeof NavigationHost): BrowserNavigationHosts {
  class BrowserNavigationHost extends port {
    static create(
      reading: BrowserNavigationReading,
      actions: BrowserNavigationActions,
    ): BrowserNavigationHost {
      return new BrowserNavigationHost(reading, actions);
    }

    private constructor(
      private readonly reading: BrowserNavigationReading,
      private readonly actions: BrowserNavigationActions,
    ) {
      super();
    }

    organizations(): NavigationOrganization[] {
      return this.reading.organizations;
    }

    organization(): NavigationOrganization | undefined {
      return this.reading.organization;
    }

    team(): NavigationTeam | undefined {
      return this.reading.team;
    }

    project(): NavigationProject | undefined {
      return this.reading.project;
    }

    openableTeams(): readonly NavigationTeam[] {
      return this.reading.openableTeams;
    }

    isLoading(): boolean {
      return this.reading.isLoading;
    }

    currentUser(): NavigationUser | undefined {
      return this.reading.currentUser;
    }

    organizationRole(): string | undefined {
      return this.reading.organizationRole;
    }

    rememberedProjectSlug(): string {
      return this.reading.rememberedProjectSlug;
    }

    hasPermission(permission: string): boolean {
      return this.reading.hasPermission(permission);
    }

    /** The port's own tri-state: unanswered is neither on nor off. */
    featureFlag(flag: string): NavigationFlagReading {
      const answer = this.reading.featureFlag(flag);
      return { enabled: answer === true, isLoading: answer === void 0 };
    }

    waiting(): ReactNode {
      return this.reading.waiting;
    }

    notFound(): ReactNode {
      return this.reading.notFound;
    }

    pathname(): string {
      return this.reading.pathname;
    }

    override routePattern(): string {
      return this.reading.routePattern;
    }

    search(): string {
      return this.reading.search;
    }

    projectParam(): string | undefined {
      return this.reading.projectParam;
    }

    projectSlugFromAddress(): string | undefined {
      return this.reading.projectSlugFromAddress;
    }

    catchAllPath(): string {
      return this.reading.catchAllPath;
    }

    deployment(): NavigationDeployment {
      return this.reading.deployment;
    }

    plan(): NavigationPlanReading {
      return this.reading.plan;
    }

    opsAccess(): NavigationOpsAccess {
      return this.reading.opsAccess;
    }

    commandBar(): NavigationCommandBar | null {
      return this.reading.commandBar;
    }

    langy(): NavigationLangy | null {
      return this.reading.langy;
    }

    /** No live-chat bubble: this application does not carry the Crisp script. */
    supportChat(): NavigationSupportChat | null {
      return null;
    }

    accountMenu(): NavigationAccountMenu | null {
      return this.reading.accountMenu;
    }

    navigate(to: string): void {
      this.actions.navigate(to);
    }

    replace(to: string): void {
      this.actions.replace(to);
    }

    back(): void {
      this.actions.back();
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

    openDrawer(drawer: string, params?: Record<string, string>): void {
      this.actions.openDrawer(drawer, params);
    }

    override joinOffer(input: { currentOrganizationId: string | null | undefined }): ReactNode {
      return joinOffer(input);
    }

    /** "Check again" reloads the page, so a membership granted meanwhile is read afresh. */
    override teamAccessWaiting({ organizationName }: { organizationName: string }): ReactNode {
      return teamAccessWaiting({ organizationName, onCheckAccess: () => window.location.reload() });
    }

    override organizationMfaGate(input: {
      organizationId: string | undefined;
      isPersonalScope: boolean;
      body: ReactNode;
    }): ReactNode {
      return organizationMfaGate(input);
    }
  }

  return { create: (reading, actions) => BrowserNavigationHost.create(reading, actions) };
}
