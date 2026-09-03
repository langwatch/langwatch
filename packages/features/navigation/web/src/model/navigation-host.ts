/**
 * What the navigation feature asks of the application it is mounted in.
 *
 * Everything the landing redirect and the project switcher used to read off
 * `platform/app` — the organization graph, the signed-in user, the grants, the
 * feature flags and the address bar — arrives through this one declaration, so
 * the package names none of that application's modules.
 *
 * The port is deliberately SYNCHRONOUS and fail-closed, the same contract
 * `apps/ui`'s session capability already keeps: a grant or a flag that has not
 * answered yet reads as "not yet", never as "yes". `isLoading()` is what tells
 * the redirect to wait rather than to decide against a half-read workspace.
 */

import { createContext, useContext, type ReactNode } from "react";

/** A project as the switcher and the landing redirect need to know it. */
export type NavigationProject = {
  id: string;
  name: string;
  slug: string;
  isPersonal?: boolean | null;
  /**
   * When this project last sent coding-agent telemetry.
   *
   * The project column offers a Sessions and a Pull requests destination only
   * to projects that actually send one, and only while the signal is recent —
   * a project that stops sending loses the destination rather than keeping a
   * link to an empty page forever (`coding-agent-activity`). Absent when the
   * application's workspace graph did not read the column, which
   * `withinDays` already treats as outside every window: the entries are not
   * offered, which is the fail-closed answer.
   *
   * Spec: specs/coding-agent/project-menu-links.feature
   */
  lastCodingAgentSessionAt?: Date | string | null;
  lastCodingAgentPullRequestAt?: Date | string | null;
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

/**
 * A change to the scope this device remembers.
 *
 * Written through the host because the keys are the application shell's own
 * (`ui-scope-storage`), and a second writer of the same `localStorage` key in
 * a package is the split brain the landing move already refused. An empty
 * string clears a key: switching organization has to forget the project,
 * which belongs to the organization being left.
 */
export type NavigationScopeWrite = {
  organizationId?: string;
  projectSlug?: string;
};

/**
 * The search palette, when the application has one.
 *
 * A `ReactNode` plus the two things the sidebar entry needs — the shortcut it
 * prints and the way to open it — the shape `waiting()` and `projectSwitcher()`
 * established. `null` is a real answer: a host with no palette renders no Quick
 * Search entry and no header trigger, rather than an entry that does nothing.
 */
export type NavigationCommandBar = {
  shortcut: string;
  open: () => void;
  trigger: ReactNode;
};

/**
 * The assistant, when this application composes one and this reader may start
 * a turn with it.
 *
 * THE COMMAND BAR'S ONE DOOR INTO LANGY, and it is a host answer rather than
 * an import for the reason every other cross-family reach in this package is:
 * `@langwatch/langy-web` is a feature-web package and this one may not name it.
 * What the palette actually needs is small — may this reader ask, a way to
 * hand a question over, a way to tell a minimised panel to stand down while
 * the home's field is in use, and the mark to draw in the composer — so the
 * port carries those four and nothing of the assistant itself.
 *
 * `null` is a real answer: a reader holding only `langy:view` is not offered
 * the hand-off at all, because the hand-off queues a prompt that auto-sends
 * and offering it would be an invitation into a 403.
 */
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

/**
 * The live-chat bubble, when this deployment carries one.
 *
 * `null` is a real answer and the Support menu reads it as one: a deployment
 * with no bubble offers the community and documentation entries and no "Chat
 * with a human", rather than an entry that opens nothing. The predicate used
 * to be `publicEnv.IS_SAAS`, which was a proxy for "is the bubble script on
 * this page"; the host now answers the question directly.
 */
export type NavigationSupportChat = {
  open: () => void;
};

/**
 * What the APPLICATION adds to the account dropdown.
 *
 * The moved menu carried three things a package cannot: an experiments dialog
 * from `@langwatch/feature-flag-web`, an impersonation switch-back entry from
 * `platform/app`'s ops components, and a reduced-graphics store the
 * application owns. All three arrive as nodes and callbacks, the shape
 * `waiting()` established, so this package depends on none of them. `null` is
 * a real answer: the menu then carries its own entries and nothing else.
 */
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
  /** Overlays those entries open, rendered inside the menu root. */
  dialogs?: ReactNode;
  experiments?: { open: () => void; hasUnseen: boolean };
  graphicsQuality?: {
    value: string;
    label: string;
    set: (value: string) => void;
  };
};

export abstract class NavigationHostPort {
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

  /**
   * The router's matched pattern for the address on screen, params spelled
   * `:name` — `/:project/traces/:traceId` for `/acme-app/traces/trace_abc`.
   *
   * The one reader is the project switcher: a trace id can't exist in another
   * project, so picking a project on a route with a second dynamic segment
   * drops to the segment's parent instead of building a 404. Optional because
   * a host with no router (a test, a static shell) has no pattern to give.
   */
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

  /**
   * Opens a drawer BY NAME, against whatever registry the application composed.
   *
   * The command catalogue names drawers eight other families own. None of them
   * is this package's to import, and none of them has to be: `?drawer.open=`
   * is an address, so the catalogue carries the name and the host resolves it.
   * A host whose registry has no such drawer opens nothing, which is the same
   * answer a mistyped address has always given.
   */
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

const NavigationHostContext = createContext<NavigationHostPort | undefined>(void 0);

/** Publishes the host to the screens and everything they render. */
export const NavigationHostProvider = NavigationHostContext.Provider;

/**
 * The host this feature is mounted in.
 *
 * Throws rather than degrading: a navigation surface with no host cannot pick
 * a destination, and a silent default would send the reader somewhere wrong.
 */
export function useNavigationHost(): NavigationHostPort {
  const host = useContext(NavigationHostContext);
  if (!host) {
    throw new Error("No NavigationHostPort in context. Mount NavigationHostProvider above.");
  }
  return host;
}

/**
 * The host, or nothing.
 *
 * For the one control that is handed ACROSS a seam rather than rendered where
 * it was built: the project switcher travels to a screen as a `ReactNode`, and
 * a screen mounted somewhere the chrome does not reach would otherwise crash on
 * a header decoration. Rendering no switcher is the honest answer there — the
 * same answer the port gave before there was one.
 */
export function useOptionalNavigationHost(): NavigationHostPort | undefined {
  return useContext(NavigationHostContext);
}
