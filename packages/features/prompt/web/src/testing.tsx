/**
 * What this package's suites mount the screen inside.
 *
 * The host port is an abstract class, so a test constructs one rather than
 * mocking a module: the fake below RECORDS what the screen asked the
 * application to do — which query it wrote, which platform drawer it addressed,
 * what it reported, whether it asked for an upgrade — which is exactly the
 * surface the real adapter answers. The same shape `@langwatch/gateway-web`'s
 * `testing.tsx` introduced.
 *
 * Its tab storage is an in-memory double rather than jsdom's `localStorage`,
 * which is the whole reason the store took its capabilities as an argument:
 * one test's open tabs cannot leak into the next.
 *
 * Not exported from the package. A test imports it relatively; nothing outside
 * this package has any business constructing a host.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { PromptBrowserStorage, PromptTabsCapabilities } from "./model/browser-capabilities";
import {
  PromptHostPort,
  PromptHostProvider,
  type PromptCopyTarget,
  type PromptFailureNotice,
  type PromptHostScope,
  type PromptPlatformDrawer,
  type PromptRouteReading,
  type PromptSuccessNotice,
} from "./model/prompt-host";

/** One recorded `openPlatformDrawer` call. */
export type RecordedDrawerOpen = {
  drawer: PromptPlatformDrawer;
  params: Readonly<Record<string, string | undefined>>;
};

/** Web Storage over a plain object, so one test cannot see another's tabs. */
export function createMemoryStorage(): PromptBrowserStorage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
}

export class FakePromptHost extends PromptHostPort {
  readonly queryWrites: Array<Readonly<Record<string, string | undefined>>> = [];
  readonly navigations: string[] = [];
  readonly drawerOpens: RecordedDrawerOpen[] = [];
  readonly successes: PromptSuccessNotice[] = [];
  readonly failures: PromptFailureNotice[] = [];
  upgradesRequested = 0;

  private readonly capabilities: PromptTabsCapabilities;

  constructor(
    private readonly options: {
      scope?: Partial<PromptHostScope>;
      grants?: ReadonlySet<string>;
      query?: Readonly<Record<string, string | undefined>>;
      copyTargets?: readonly PromptCopyTarget[];
      storage?: PromptBrowserStorage;
      reportedGlobally?: boolean;
    } = {},
  ) {
    super();
    this.capabilities = {
      storage: options.storage ?? createMemoryStorage(),
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    };
  }

  scope(): PromptHostScope {
    return {
      organizationId: "org-1",
      teamId: "team-1",
      projectId: "proj-1",
      projectSlug: "web-app",
      projectApiKey: "test-api-key",
      ...this.options.scope,
    };
  }

  hasPermission(permission: string): boolean {
    return (
      this.options.grants ?? new Set(["prompts:view", "prompts:create", "evaluations:manage"])
    ).has(permission);
  }

  route(): PromptRouteReading {
    return { params: {}, query: this.options.query ?? {} };
  }

  setQuery(next: Readonly<Record<string, string | undefined>>): void {
    this.queryWrites.push(next);
  }

  navigate(to: string): void {
    this.navigations.push(to);
  }

  succeeded(notice: PromptSuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: PromptFailureNotice): void {
    this.failures.push(failure);
  }

  isReportedGlobally(): boolean {
    return this.options.reportedGlobally ?? false;
  }

  copyTargets(): readonly PromptCopyTarget[] {
    return this.options.copyTargets ?? [];
  }

  tabCapabilities(): PromptTabsCapabilities {
    return this.capabilities;
  }

  requestUpgrade(): void {
    this.upgradesRequested += 1;
  }

  openPlatformDrawer(request: {
    drawer: PromptPlatformDrawer;
    params?: Readonly<Record<string, string | undefined>>;
  }): void {
    this.drawerOpens.push({ drawer: request.drawer, params: request.params ?? {} });
  }
}

/** Renders a screen module inside the Design System's provider and a host. */
export function renderWithPromptHost(
  element: ReactElement,
  host: FakePromptHost = new FakePromptHost(),
) {
  return {
    host,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <PromptHostProvider value={host}>{element}</PromptHostProvider>
      </ChakraProvider>,
    ),
  };
}

/** Mounts a host above an already-rendered tree, for tests that render themselves. */
export function withPromptHost(element: ReactElement, host: FakePromptHost): ReactElement {
  return <PromptHostProvider value={host}>{element}</PromptHostProvider>;
}
