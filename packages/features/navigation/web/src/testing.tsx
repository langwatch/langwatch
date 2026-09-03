/**
 * What a test mounts this package's screens and chrome inside.
 *
 * One stub host, built from a partial reading, so a suite states only the facts
 * its scenario turns on and gets fail-closed answers for the rest. The same
 * shape every other feature-web package's `testing` entry keeps.
 *
 * "Fail-closed" is what the defaults are for: no grants, no flags, no palette,
 * no chat bubble, a self-hosted deployment that is not a development build, a
 * free plan and no operator access. A shell rendered against this stub draws
 * the narrowest chrome the product has, which is the honest baseline for a
 * suite that names nothing.
 */

import type { ReactNode } from "react";
import {
  NavigationHostPort,
  NavigationHostProvider,
  type NavigationAccountMenu,
  type NavigationCommandBar,
  type NavigationDeployment,
  type NavigationFlagReading,
  type NavigationLangy,
  type NavigationOpsAccess,
  type NavigationOrganization,
  type NavigationPlanReading,
  type NavigationProject,
  type NavigationScopeWrite,
  type NavigationSupportChat,
  type NavigationTeam,
  type NavigationUser,
} from "./model/navigation-host";

export type StubNavigationReadings = {
  organizations?: NavigationOrganization[];
  organization?: NavigationOrganization;
  project?: NavigationProject;
  team?: NavigationTeam;
  openableTeams?: readonly NavigationTeam[];
  isLoading?: boolean;
  /** A convenience over `currentUser` for a suite that names only the id. */
  currentUserId?: string;
  currentUser?: NavigationUser;
  organizationRole?: string;
  rememberedProjectSlug?: string;
  permissions?: readonly string[];
  flags?: Readonly<Record<string, NavigationFlagReading>>;
  waiting?: ReactNode;
  notFound?: ReactNode;
  pathname?: string;
  search?: string;
  projectParam?: string;
  catchAllPath?: string;
  deployment?: Partial<NavigationDeployment>;
  plan?: Partial<NavigationPlanReading>;
  opsAccess?: Partial<NavigationOpsAccess>;
  commandBar?: NavigationCommandBar | null;
  langy?: NavigationLangy | null;
  supportChat?: NavigationSupportChat | null;
  accountMenu?: NavigationAccountMenu | null;
};

export type StubNavigationActions = {
  replace?: (to: string) => void;
  navigate?: (to: string) => void;
  back?: () => void;
  rememberScope?: (write: NavigationScopeWrite) => void;
  signOut?: () => void;
  setDocumentTitle?: (title: string) => void;
  openDrawer?: (drawer: string, params?: Record<string, string>) => void;
};

const SELF_HOSTED_PRODUCTION: NavigationDeployment = {
  isSaaS: false,
  isDevelopment: false,
  hasNlpService: true,
  hasLangevals: true,
};

const FREE_PLAN: NavigationPlanReading = {
  isEnterprise: false,
  isLoading: false,
  isLiteMember: false,
};

const NO_OPS_ACCESS: NavigationOpsAccess = { hasAccess: false, isAdmin: false };

export class StubNavigationHost extends NavigationHostPort {
  static create(
    readings: StubNavigationReadings = {},
    actions: StubNavigationActions = {},
  ): StubNavigationHost {
    return new StubNavigationHost(readings, actions);
  }

  private constructor(
    private readonly readings: StubNavigationReadings,
    private readonly actions: StubNavigationActions,
  ) {
    super();
  }

  organizations(): NavigationOrganization[] {
    return this.readings.organizations ?? [];
  }

  organization(): NavigationOrganization | undefined {
    return this.readings.organization;
  }

  project(): NavigationProject | undefined {
    return this.readings.project;
  }

  team(): NavigationTeam | undefined {
    return this.readings.team;
  }

  openableTeams(): readonly NavigationTeam[] {
    return this.readings.openableTeams ?? this.readings.organization?.teams ?? [];
  }

  isLoading(): boolean {
    return this.readings.isLoading ?? false;
  }

  currentUser(): NavigationUser | undefined {
    if (this.readings.currentUser) return this.readings.currentUser;
    if (this.readings.currentUserId === void 0) return void 0;
    return {
      id: this.readings.currentUserId,
      name: null,
      email: null,
      image: null,
    };
  }

  organizationRole(): string | undefined {
    return this.readings.organizationRole;
  }

  rememberedProjectSlug(): string {
    return this.readings.rememberedProjectSlug ?? "";
  }

  hasPermission(permission: string): boolean {
    return (this.readings.permissions ?? []).includes(permission);
  }

  featureFlag(flag: string): NavigationFlagReading {
    return this.readings.flags?.[flag] ?? { enabled: false, isLoading: false };
  }

  waiting(): ReactNode {
    return this.readings.waiting ?? null;
  }

  notFound(): ReactNode {
    return this.readings.notFound ?? null;
  }

  pathname(): string {
    return this.readings.pathname ?? "/";
  }

  search(): string {
    return this.readings.search ?? "";
  }

  projectParam(): string | undefined {
    return this.readings.projectParam;
  }

  catchAllPath(): string {
    return this.readings.catchAllPath ?? "";
  }

  deployment(): NavigationDeployment {
    return { ...SELF_HOSTED_PRODUCTION, ...this.readings.deployment };
  }

  plan(): NavigationPlanReading {
    return { ...FREE_PLAN, ...this.readings.plan };
  }

  opsAccess(): NavigationOpsAccess {
    return { ...NO_OPS_ACCESS, ...this.readings.opsAccess };
  }

  commandBar(): NavigationCommandBar | null {
    return this.readings.commandBar ?? null;
  }

  openDrawer(drawer: string, params?: Record<string, string>): void {
    this.actions.openDrawer?.(drawer, params);
  }

  langy(): NavigationLangy | null {
    return this.readings.langy ?? null;
  }

  supportChat(): NavigationSupportChat | null {
    return this.readings.supportChat ?? null;
  }

  accountMenu(): NavigationAccountMenu | null {
    return this.readings.accountMenu ?? null;
  }

  rememberScope(write: NavigationScopeWrite): void {
    this.actions.rememberScope?.(write);
  }

  signOut(): void {
    this.actions.signOut?.();
  }

  setDocumentTitle(title: string): () => void {
    this.actions.setDocumentTitle?.(title);
    return () => void 0;
  }

  replace(to: string): void {
    this.actions.replace?.(to);
  }

  navigate(to: string): void {
    this.actions.navigate?.(to);
  }

  back(): void {
    this.actions.back?.();
  }
}

/** Mounts children under a stub host. */
export function WithStubNavigationHost({
  children,
  readings,
  actions,
}: {
  children: ReactNode;
  readings?: StubNavigationReadings;
  actions?: StubNavigationActions;
}) {
  return (
    <NavigationHostProvider value={StubNavigationHost.create(readings, actions)}>
      {children}
    </NavigationHostProvider>
  );
}
