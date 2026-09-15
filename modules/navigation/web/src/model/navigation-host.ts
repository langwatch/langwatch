/** Navigation feature port; synchronous and fail-closed, same contract as apps/ui session */

import { createContext, useContext, type ReactNode } from "react";

/** A project as the switcher and the landing redirect need to know it. */
export type NavigationProject = {
  id: string;
  name: string;
  slug: string;
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
   * Whose personal workspace this is, on the teams that are one.
   *
   * The shell compares it against the reader to tell "my own workspace" from
   * "somebody else's, opened as an administrator" — two different chromes, and
   * one banner that must not appear over the first.
   */
  ownerUserId?: string | null;
  /** Who may open the team. Absent when the application did not read it. */
  members?: { userId: string }[];
  projects: NavigationProject[];
};

export type NavigationOrganization = {
  id: string;
  name: string;
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
 * The signed-in reader, as the shell's chrome needs them.
 *
 * `impersonator` is present only while an operator is viewing the product as
 * this reader; the header tints itself off it, exactly as the application's
 * own chrome did.
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
  isDevelopment: boolean;
  /** The shared demo project, when this deployment configures one. */
  demoProjectSlug?: string;
  hasNlpService: boolean;
  hasLangevals: boolean;
};

/**
 * The plan the menu's gates read.
 *
 * `isLoading` is kept for the reason the settings menu's own docblock gives:
 * the enterprise entries are shown WHILE the plan is still arriving, so a
 * reader on that plan never watches four links appear a beat after the page.
 */
export type NavigationPlanReading = {
  isEnterprise: boolean;
  isLoading: boolean;
  /** A lite member sees a narrower menu; the guard is the host's. */
  isLiteMember: boolean;
  /**
   * How the organization is priced, in the wire's own spelling.
   *
   * The usage meter compares it against one value and nothing else reads it,
   * which is why the port carries a string rather than restating a Prisma
   * enum a governed web package may not import.
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

/** Command bar when app has one; null is real answer, no palette = no Quick Search entry */
export type NavigationCommandBar = {
  shortcut: string;
  open: () => void;
  trigger: ReactNode;
};

/** Assistant/Langy when app composes one; host answer avoids importing langy-web package */
export type NavigationLangy = {
  /** Hand a typed question to the assistant. It opens and sends. */
  ask: (prompt: string) => void;
  /**
   * Tell a minimised assistant that an inline palette has the reader's
   * attention, so the two do not talk over each other on the home page.
   */
  setHomeAskOpen: (open: boolean) => void;
  /** The assistant's own mark, drawn in the palette's composer. */
  mark: ReactNode;
};

/** Live-chat bubble when deployment has one; null is real answer, no bubble = no chat entry */
export type NavigationSupportChat = {
  open: () => void;
};

/** Account menu additions from app; experiments, impersonation, graphics quality; null is real */
export type NavigationAccountMenu = {
  /**
   * What the application draws in the header beside the avatar.
   *
   * The impersonation banner is the one thing here today: it belongs next to
   * the account controls and it belongs to `@langwatch/ops-web`.
   */
  headerBanner?: ReactNode;
  /** Entries drawn above the account group. */
  leading?: ReactNode;
  /** Entries drawn below the application's own controls. */
  trailing?: ReactNode;
  /**
   * The presence-broadcast toggle, on the surfaces where presence is live.
   *
   * It reads a presence store and a presence feature gate that belong to
   * `@langwatch/trace-web`, so it arrives as a node like the rest. Absent is a
   * real answer and the only one off the Trace Explorer: the menu then carries
   * no presence row at all rather than one that toggles nothing.
   */
  presence?: ReactNode;
  /** Overlays those entries open, rendered inside the menu root. */
  dialogs?: ReactNode;
  experiments?: { open: () => void; hasUnseen: boolean };
  graphicsQuality?: {
    value: string;
    label: string;
    set: (value: string) => void;
  };
};

export abstract class NavigationHost {
  /** Every organization the reader belongs to; empty is a real answer. */
  abstract organizations(): NavigationOrganization[];

  /** The organization the current address is about, when there is one. */
  abstract organization(): NavigationOrganization | undefined;

  /** The project the current address is about, when there is one. */
  abstract project(): NavigationProject | undefined;

  /** Whether the workspace reads above are still arriving. */
  abstract isLoading(): boolean;

  /** The signed-in reader, absent until the session answers. */
  abstract currentUser(): NavigationUser | undefined;

  /**
   * The signed-in user's id, absent until the session answers.
   *
   * Derived rather than asked for a second time: two ports answering for the
   * same reader is exactly how the two halves of a chrome drift apart.
   */
  currentUserId(): string | undefined {
    return this.currentUser()?.id;
  }

  /**
   * The reader's role in the resolved organization, in the vocabulary the
   * application's own graph carries. Only compared for equality here, which is
   * why the port takes a string rather than restating a Prisma enum.
   */
  abstract organizationRole(): string | undefined;

  /**
   * Teams the reader may open, in the host's ambient preference order.
   *
   * "May open" and "which one is ambient" are the application's own scope
   * policy — the same test its chrome applies before rendering a page — so the
   * host answers with the list already filtered and ordered rather than handing
   * the raw graph over with the rules attached.
   */
  abstract openableTeams(): readonly NavigationTeam[];

  /**
   * The project slug this device last had open, or "".
   *
   * The application shell's own scope memory, not a key this package writes.
   */
  abstract rememberedProjectSlug(): string;

  /** Fail-closed grant check. */
  abstract hasPermission(permission: string): boolean;

  /** Fail-closed flag check, with the pending state kept. */
  abstract featureFlag(flag: string): NavigationFlagReading;

  /**
   * Whether this project asked to keep the previous simulations screens — the
   * scenario family's choice, which the Test section honours over the Agent
   * Testing flag. Spec: specs/suites/new-simulations-callout.feature
   */
  abstract prefersPreviousSimulationsScreens(): boolean;

  /**
   * What the application shows while a navigation decision is still being made.
   *
   * The wait belongs to the host: it is that application's chrome, its logo and
   * its motion budget, and a package may not reach for any of the three. The
   * same shape the organization family's `projectSwitcher()` established.
   */
  abstract waiting(): ReactNode;

  /** Replaces the current address — the landing redirect's only navigation. */
  abstract replace(to: string): void;

  /** Pushes an address — what picking a project in the switcher does. */
  abstract navigate(to: string): void;

  /**
   * Goes back one entry in this tab's history.
   *
   * One reader: the not-found scene, where "take me back" means the page the
   * reader came from and nothing this package could compute.
   */
  abstract back(): void;

  /**
   * The team the current address resolved to, when there is one.
   *
   * The shell reads exactly one thing off it that the project cannot answer:
   * whether the reader is standing inside their OWN personal workspace, which
   * is what turns a `/:project/...` address into the personal chrome.
   */
  abstract team(): NavigationTeam | undefined;

  /**
   * The address on screen, path only.
   *
   * The pathname the reader sees, never a route pattern: every settings page
   * but two resolves to one registered pattern, so an entry matched against a
   * pattern lights nothing. `isSettingsMenuItemActive` says the same thing.
   */
  abstract pathname(): string;

  /** Router matched pattern; project switcher reads it to drop trailing dynamic segments */
  routePattern(): string | undefined {
    return void 0;
  }

  /**
   * The segments a catch-all route captured, already joined with "/".
   *
   * One reader: the project-prefixed redirect, whose whole job is to put the
   * reader's own project slug in front of the rest of the address.
   */
  abstract catchAllPath(): string;

  /**
   * The `:project` segment of the address, when the address has one.
   *
   * The shell's not-found branch turns on it: an address that NAMES a project
   * the workspace does not carry is a wrong address, while an address that
   * names none simply has no project.
   */
  abstract projectParam(): string | undefined;

  /** What kind of deployment this is. */
  abstract deployment(): NavigationDeployment;

  /** The plan and membership gates the settings menu reads. */
  abstract plan(): NavigationPlanReading;

  /** Whether the reader reaches the internal operations pages. */
  abstract opsAccess(): NavigationOpsAccess;

  /** Remembers a scope choice on this device. */
  abstract rememberScope(write: NavigationScopeWrite): void;

  /**
   * Ends the session.
   *
   * The identity client is the application's ONE instance, so the package
   * asks rather than constructing a second one — a governed web package may
   * not import an authentication implementation at all.
   */
  abstract signOut(): void;

  /** The search palette, or nothing when this application has none. */
  abstract commandBar(): NavigationCommandBar | null;

  /** Opens drawer by name; host resolves against its registry, missing = no-op */
  abstract openDrawer(drawer: string, params?: Record<string, string>): void;

  /** The assistant, or nothing when this reader may not start a turn. */
  abstract langy(): NavigationLangy | null;

  /** The live-chat bubble, or nothing when this deployment carries none. */
  abstract supportChat(): NavigationSupportChat | null;

  /** What the application adds to the account dropdown, if anything. */
  abstract accountMenu(): NavigationAccountMenu | null;

  /**
   * The query string of the address on screen, leading `?` included.
   *
   * Read by one thing: the settings return path, which captures the WHOLE
   * address a reader left so "back" lands them where they were rather than at
   * the top of the page they were reading.
   */
  abstract search(): string;

  /** What the application draws for an address that names no page. */
  abstract notFound(): ReactNode;

  /**
   * Sets the document's title, and hands back the way to put it back.
   *
   * The shell titles the page from the project and the open destination, the
   * way the application chrome always did; where that title is WRITTEN is the
   * host's, since a package may not reach for `document`.
   */
  abstract setDocumentTitle(title: string): () => void;
}

const NavigationHostContext = createContext<NavigationHost | undefined>(void 0);

/** Publishes the host to the screens and everything they render. */
export const NavigationHostProvider = NavigationHostContext.Provider;

/**
 * The host this feature is mounted in.
 *
 * Throws rather than degrading: a navigation surface with no host cannot pick
 * a destination, and a silent default would send the reader somewhere wrong.
 */
export function useNavigationHost(): NavigationHost {
  const host = useContext(NavigationHostContext);
  if (!host) {
    throw new Error("No NavigationHost in context. Mount NavigationHostProvider above.");
  }
  return host;
}

/** Host or nothing; for controls handed across seams; missing = no-op for switcher */
export function useOptionalNavigationHost(): NavigationHost | undefined {
  return useContext(NavigationHostContext);
}
