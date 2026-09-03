/**
 * The application an Ops screen is mounted in, faked.
 *
 * Every surface in this package reads the world through `OpsHostPort`: whether
 * the reader is an operator, whether they are an admin, what the address says,
 * and where a success or a failure is announced. A test that mounts one
 * therefore has to answer that port, and answering it ad hoc per file is how a
 * dozen suites come to disagree about what an operator is.
 *
 * Two things live here. `fakeOpsHost` builds the port from a small configuration
 * and records everything written through it, so an assertion about a navigation
 * or a notice reads off `host.recording` rather than off a spy on a module.
 * `renderWithOpsHost` mounts a tree underneath it and owns the one piece of
 * state a static double cannot have: the query string. Every Ops overlay opens
 * from a query key now — the queue group from `?group=`, the payload store from
 * `?payloadStore=` — so a click that writes the address has to come back as a
 * re-render, or the drawer never opens and the test proves nothing.
 *
 * The same shape as `@langwatch/gateway-web`'s harness, because the two host
 * ports are the same shape. They converge if the ports are ever promoted.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, type RenderResult } from "@testing-library/react";
import { useMemo, useState, type ReactElement, type ReactNode } from "react";

import type { OpsToast, OpsToaster } from "./behavior/ops-feedback";
import {
  OpsHostPort,
  OpsHostProvider,
  type OpsFailureNotice,
  type OpsProject,
  type OpsRouteReading,
  type OpsSuccessNotice,
} from "./model/ops-host";

export type OpsQuery = Readonly<Record<string, string | undefined>>;

/** Everything a surface wrote through the host, in the order it wrote it. */
export type OpsHostRecording = {
  navigations: string[];
  queries: Array<{ next: OpsQuery; replace: boolean }>;
  successes: OpsSuccessNotice[];
  failures: OpsFailureNotice[];
};

/** The project an operator is standing in, unless a test says otherwise. */
export const FAKE_OPS_PROJECT: OpsProject = { id: "proj-1", apiKey: "sk-lw-test" };

export type FakeOpsHostOptions = {
  /**
   * Whether the reader may see the Ops workspace. Defaults to yes, because
   * almost every suite in this package is about what an operator sees; the
   * refusal path is what a test names explicitly.
   */
  hasOpsAccess?: boolean;
  sharedInstall?: boolean;
  /** Whether the reader may see the Backoffice, which is strictly narrower. */
  isOpsAdmin?: boolean;
  project?: OpsProject | null;
  /** Path parameters the screen was opened with, for example `{ runId: "r_1" }`. */
  params?: Readonly<Record<string, string | undefined>>;
  /** The query string the screen opens on. */
  query?: OpsQuery;
  /** The whole address including the fragment, for Deja View. */
  asPath?: string;
};

export class FakeOpsHost extends OpsHostPort {
  static create(options: FakeOpsHostOptions = {}): FakeOpsHost {
    return new FakeOpsHost({
      options,
      recording: { navigations: [], queries: [], successes: [], failures: [] },
      query: options.query ?? {},
    });
  }

  /** Shared with every host derived from this one, so one read sees them all. */
  readonly recording: OpsHostRecording;
  readonly query: OpsQuery;

  private readonly options: FakeOpsHostOptions;
  private readonly commitQuery: ((next: OpsQuery) => void) | undefined;
  /**
   * Built once per instance rather than per call. `useOpsRouter` memoizes on the
   * reading, and a fresh object every render would rebuild the router with it.
   */
  private readonly routeReading: OpsRouteReading;

  private constructor({
    options,
    recording,
    query,
    commitQuery,
  }: {
    options: FakeOpsHostOptions;
    recording: OpsHostRecording;
    query: OpsQuery;
    commitQuery?: (next: OpsQuery) => void;
  }) {
    super();
    this.options = options;
    this.recording = recording;
    this.query = query;
    this.commitQuery = commitQuery;
    this.routeReading = { params: options.params ?? {}, query };
  }

  /** The same host reading a different query, and able to write one back. */
  withQuery({
    query,
    commitQuery,
  }: {
    query: OpsQuery;
    commitQuery: (next: OpsQuery) => void;
  }): FakeOpsHost {
    return new FakeOpsHost({
      options: this.options,
      recording: this.recording,
      query,
      commitQuery,
    });
  }

  hasOpsAccess(): boolean {
    return this.options.hasOpsAccess ?? true;
  }

  isOpsAdmin(): boolean {
    return this.options.isOpsAdmin ?? this.hasOpsAccess();
  }

  sharedInstall(): boolean {
    return this.options.sharedInstall ?? false;
  }

  project(): OpsProject | undefined {
    const configured = this.options.project;
    if (configured === void 0) return FAKE_OPS_PROJECT;
    return configured ?? void 0;
  }

  route(): OpsRouteReading {
    return this.routeReading;
  }

  asPath(): string {
    return this.options.asPath ?? "/ops";
  }

  setQuery(next: OpsQuery, options?: { replace?: boolean }): void {
    this.recording.queries.push({ next, replace: options?.replace ?? false });
    this.commitQuery?.(next);
  }

  navigate(to: string): void {
    this.recording.navigations.push(to);
  }

  succeeded(notice: OpsSuccessNotice): void {
    this.recording.successes.push(notice);
  }

  failed(failure: OpsFailureNotice): void {
    this.recording.failures.push(failure);
  }
}

export function fakeOpsHost(options: FakeOpsHostOptions = {}): FakeOpsHost {
  return FakeOpsHost.create(options);
}

export type RecordingOpsToaster = OpsToaster & {
  /** Every toast the code under test raised, in order. */
  readonly toasts: OpsToast[];
};

export function recordingOpsToaster(): RecordingOpsToaster {
  const toasts: OpsToast[] = [];
  return {
    toasts,
    create: (toast: OpsToast) => {
      toasts.push(toast);
    },
  };
}

/**
 * The address, held where React can see it change.
 *
 * `setQuery` replaces the whole query string — a key left out is a key removed —
 * which is the contract the port states and the one every Ops overlay relies on
 * to drop its key when it closes.
 */
function OpsHostHarness({ host, children }: { host: FakeOpsHost; children: ReactNode }) {
  const [query, setQuery] = useState<OpsQuery>(host.query);
  const live = useMemo(
    () => host.withQuery({ query, commitQuery: (next) => setQuery(next) }),
    [host, query],
  );
  return <OpsHostProvider value={live}>{children}</OpsHostProvider>;
}

export type OpsRenderResult = RenderResult & {
  /**
   * Re-renders under the SAME host and provider.
   *
   * Testing Library's own `rerender` replaces the whole tree with what it is
   * handed, which would drop both wrappers — and a suite that re-renders to
   * pick up new mock data would then fail on a missing provider rather than on
   * what it is about.
   */
  rerenderWithOpsHost: (next: ReactElement) => void;
};

/** Mounts an Ops surface the way its frontend feature mounts it. */
export function renderWithOpsHost(
  element: ReactElement,
  { host }: { host?: FakeOpsHost } = {},
): OpsRenderResult {
  const mounted = host ?? fakeOpsHost();
  const wrap = (child: ReactElement) => (
    <ChakraProvider value={defaultSystem}>
      <OpsHostHarness host={mounted}>{child}</OpsHostHarness>
    </ChakraProvider>
  );
  const result = render(wrap(element));
  return {
    ...result,
    rerenderWithOpsHost: (next: ReactElement) => result.rerender(wrap(next)),
  };
}
