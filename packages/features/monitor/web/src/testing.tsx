/**
 * What this package's suites mount the online evaluations screen inside.
 *
 * The host port is an abstract class, so a test constructs one rather than
 * mocking a module: the fake below RECORDS what the screen asked the
 * application to do — the overlay it wanted, where it navigated, the notices it
 * reported — which is exactly the surface the real adapter answers.
 *
 * The time zone is FIXED rather than read from the machine, which is the whole
 * reason it is on the port: a monitor's week is cut into buckets by it, and a
 * suite that inherits the runner's zone asserts something different in Amsterdam
 * than in CI.
 *
 * Not exported from the package. A test imports it relatively; nothing outside
 * this package has any business constructing a host.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import {
  MonitorHostPort,
  MonitorHostProvider,
  type MonitorCopyTarget,
  type MonitorFailureNotice,
  type MonitorOverlayRequest,
  type MonitorRouteReading,
  type MonitorScope,
  type MonitorSuccessNotice,
} from "./model/monitor-host";

const DEFAULT_TARGETS: MonitorCopyTarget[] = [
  { id: "proj-1", name: "Acme / Engineering / Web App", canCreate: true },
  { id: "proj-2", name: "Acme / Engineering / Batch", canCreate: false },
];

export class FakeMonitorHost extends MonitorHostPort {
  readonly overlays: MonitorOverlayRequest[] = [];
  readonly navigations: string[] = [];
  readonly successes: MonitorSuccessNotice[] = [];
  readonly failures: MonitorFailureNotice[] = [];

  constructor(
    private readonly options: {
      scope?: Partial<MonitorScope>;
      grants?: ReadonlySet<string>;
      copyTargets?: readonly MonitorCopyTarget[];
      query?: Readonly<Record<string, string | undefined>>;
      timeZone?: string;
    } = {},
  ) {
    super();
  }

  scope(): MonitorScope {
    return { projectId: "proj-1", projectSlug: "web-app", ...this.options.scope };
  }

  hasPermission(permission: string): boolean {
    return (
      this.options.grants ??
      new Set(["evaluations:view", "evaluations:manage", "analytics:view", "experiments:view"])
    ).has(permission);
  }

  copyTargets(): readonly MonitorCopyTarget[] {
    return this.options.copyTargets ?? DEFAULT_TARGETS;
  }

  timeZone(): string {
    return this.options.timeZone ?? "Europe/Amsterdam";
  }

  route(): MonitorRouteReading {
    return { params: {}, query: this.options.query ?? {} };
  }

  navigate(to: string): void {
    this.navigations.push(to);
  }

  openOverlay(request: MonitorOverlayRequest): void {
    this.overlays.push(request);
  }

  succeeded(notice: MonitorSuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: MonitorFailureNotice): void {
    this.failures.push(failure);
  }
}

/** Renders the screen inside the Design System's provider and a host. */
export function renderWithMonitorHost(
  element: ReactElement,
  host: FakeMonitorHost = new FakeMonitorHost(),
) {
  return {
    host,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <MonitorHostProvider value={host}>{element}</MonitorHostProvider>
      </ChakraProvider>,
    ),
  };
}
