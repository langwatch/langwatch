/**
 * Test harness for mounting the evaluators screen. Constructs a fake host that records
 * what the screen asked the application to do (overlay, query, notices) for verification.
 * Internal only—not exported.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import {
  EvaluatorHostApi,
  EvaluatorHostProvider,
  type EvaluatorCopyTarget,
  type EvaluatorFailureNotice,
  type EvaluatorOverlayRequest,
  type EvaluatorRouteReading,
  type EvaluatorScope,
  type EvaluatorSuccessNotice,
} from "./model/evaluator-host.ts";

const DEFAULT_TARGETS: EvaluatorCopyTarget[] = [
  { id: "proj-1", name: "Acme / Engineering / Web App", canCreate: true },
  { id: "proj-2", name: "Acme / Engineering / Batch", canCreate: false },
];

export class FakeEvaluatorHost extends EvaluatorHostApi {
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
