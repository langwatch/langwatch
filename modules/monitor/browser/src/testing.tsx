/**
 * Test fixture: a fake host adapter that records what the screen asked; time
 * zone is fixed for deterministic assertions.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import {
  MonitorHostApi,
  MonitorHostProvider,
  type MonitorCopyTarget,
  type MonitorFailureNotice,
  type MonitorOverlayRequest,
  type MonitorRouteReading,
  type MonitorScope,
  type MonitorSuccessNotice,
} from "./model/monitor-host.ts";

const DEFAULT_TARGETS: MonitorCopyTarget[] = [
  { id: "proj-1", name: "Acme / Engineering / Web App", canCreate: true },
  { id: "proj-2", name: "Acme / Engineering / Batch", canCreate: false },
];

export class FakeMonitorHost extends MonitorHostApi {
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
