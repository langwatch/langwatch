/** Test host and harness for public annotation surfaces. */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import {
  AnnotationHostPort,
  AnnotationHostProvider,
  type AnnotationFailureNotice,
  type AnnotationHostProject,
  type AnnotationHostUser,
  type AnnotationRouteReading,
  type AnnotationSuccessNotice,
} from "./model/annotation-host.ts";

export type StubAnnotationHostOptions = {
  project?: AnnotationHostProject | undefined;
  organizationId?: string | undefined;
  currentUser?: AnnotationHostUser | undefined;
  permissions?: readonly string[];
  isLiteMember?: boolean;
  isOwnPersonalWorkspace?: boolean;
  route?: AnnotationRouteReading;
};

/** A host that answers from fixtures and records everything it is told. */
export class StubAnnotationHost extends AnnotationHostPort {
  readonly successes: AnnotationSuccessNotice[] = [];
  readonly failures: AnnotationFailureNotice[] = [];
  readonly navigations: string[] = [];
  readonly queries: Array<Readonly<Record<string, string | undefined>>> = [];

  constructor(private readonly options: StubAnnotationHostOptions = {}) {
    super();
  }

  project(): AnnotationHostProject | undefined {
    return "project" in this.options
      ? this.options.project
      : { id: "proj-1", slug: "test-project", name: "Test Project" };
  }

  organizationId(): string | undefined {
    return "organizationId" in this.options ? this.options.organizationId : "org-1";
  }

  currentUser(): AnnotationHostUser | undefined {
    return "currentUser" in this.options
      ? this.options.currentUser
      : { id: "user-1", name: "Ana Reviewer", image: null };
  }

  hasPermission(permission: string): boolean {
    return (
      this.options.permissions ?? ["annotations:view", "annotations:update", "project:view"]
    ).includes(permission);
  }

  isLiteMember(): boolean {
    return this.options.isLiteMember ?? false;
  }

  isOwnPersonalWorkspace(): boolean {
    return this.options.isOwnPersonalWorkspace ?? false;
  }

  route(): AnnotationRouteReading {
    return this.options.route ?? { params: {}, query: {} };
  }

  setQuery(next: Readonly<Record<string, string | undefined>>): void {
    this.queries.push(next);
  }

  navigate(to: string): void {
    this.navigations.push(to);
  }

  succeeded(notice: AnnotationSuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: AnnotationFailureNotice): void {
    this.failures.push(failure);
  }

  /** The last query write, which is what an address assertion is about. */
  get lastQuery(): Readonly<Record<string, string | undefined>> | undefined {
    return this.queries.at(-1);
  }
}

/** The providers every annotations component needs before it can render. */
export function AnnotationTestHarness({
  host,
  children,
}: {
  host: AnnotationHostPort;
  children: ReactNode;
}) {
  return (
    <ChakraProvider value={defaultSystem}>
      <AnnotationHostProvider value={host}>{children}</AnnotationHostProvider>
    </ChakraProvider>
  );
}

/** Renders one element inside the harness and hands back the host it recorded on. */
export function renderWithAnnotationHost(
  element: ReactElement,
  options: StubAnnotationHostOptions = {},
): RenderResult & { host: StubAnnotationHost } {
  const host = new StubAnnotationHost(options);

  return {
    ...render(<AnnotationTestHarness host={host}>{element}</AnnotationTestHarness>),
    host,
  };
}
