/**
 * What this package's suites mount the evaluators screen inside.
 *
 * The host port is an abstract class, so a test constructs one rather than
 * mocking a module: the fake below RECORDS what the screen asked the
 * application to do — the overlay it wanted, the query it wrote, the notices it
 * reported — which is exactly the surface the real adapter answers.
 *
 * Not exported from the package. A test imports it relatively; nothing outside
 * this package has any business constructing a host.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import {
  EvaluatorHostPort,
  EvaluatorHostProvider,
  type EvaluatorCopyTarget,
  type EvaluatorFailureNotice,
  type EvaluatorOverlayRequest,
  type EvaluatorRouteReading,
  type EvaluatorScope,
  type EvaluatorSuccessNotice,
} from "./model/evaluator-host";

const DEFAULT_TARGETS: EvaluatorCopyTarget[] = [
  { id: "proj-1", name: "Acme / Engineering / Web App", canCreate: true },
  { id: "proj-2", name: "Acme / Engineering / Batch", canCreate: false },
];

export class FakeEvaluatorHost extends EvaluatorHostPort {
  readonly overlays: EvaluatorOverlayRequest[] = [];
  readonly queries: Record<string, string | undefined>[] = [];
  readonly successes: EvaluatorSuccessNotice[] = [];
  readonly failures: EvaluatorFailureNotice[] = [];

  constructor(
    private readonly options: {
      scope?: Partial<EvaluatorScope>;
      grants?: ReadonlySet<string>;
      copyTargets?: readonly EvaluatorCopyTarget[];
      query?: Readonly<Record<string, string | undefined>>;
    } = {},
  ) {
    super();
  }

  scope(): EvaluatorScope {
    return { projectId: "proj-1", projectSlug: "web-app", ...this.options.scope };
  }

  hasPermission(permission: string): boolean {
    return (this.options.grants ?? new Set(["evaluations:view", "evaluations:manage"])).has(
      permission,
    );
  }

  copyTargets(): readonly EvaluatorCopyTarget[] {
    return this.options.copyTargets ?? DEFAULT_TARGETS;
  }

  route(): EvaluatorRouteReading {
    return { params: {}, query: this.options.query ?? {} };
  }

  setQuery(next: Readonly<Record<string, string | undefined>>): void {
    this.queries.push({ ...next });
  }

  openOverlay(request: EvaluatorOverlayRequest): void {
    this.overlays.push(request);
  }

  succeeded(notice: EvaluatorSuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: EvaluatorFailureNotice): void {
    this.failures.push(failure);
  }
}

/** Renders the screen inside the Design System's provider and a host. */
export function renderWithEvaluatorHost(
  element: ReactElement,
  host: FakeEvaluatorHost = new FakeEvaluatorHost(),
) {
  return {
    host,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <EvaluatorHostProvider value={host}>{element}</EvaluatorHostProvider>
      </ChakraProvider>,
    ),
  };
}
