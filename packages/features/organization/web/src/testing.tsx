/**
 * What this package's suites mount the screen inside.
 *
 * The host port is an abstract class, so a test constructs one rather than
 * mocking a module: the fake below RECORDS what the screen asked the
 * application to do — the query it wrote, the file it handed over, the failure
 * it reported — which is exactly the surface the real adapter answers.
 *
 * Not exported from the package. A test imports it relatively; nothing outside
 * this package has any business constructing a host.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import {
  type OrganizationActor,
  type OrganizationProjectReading,
  type OrganizationSuccessNotice,
  OrganizationHostPort,
  OrganizationHostProvider,
  type OrganizationDownload,
  type OrganizationFailureNotice,
  type OrganizationReading,
  type OrganizationRouteReading,
  type OrganizationScope,
} from "./model/organization-host";

const DEFAULT_ACTOR: OrganizationActor = {
  id: "user-1",
  name: "Ada",
  email: "ada@example.com",
  image: null,
};

const DEFAULT_ORGANIZATION: OrganizationReading = {
  id: "org-1",
  name: "Acme",
  teams: [
    {
      id: "team-1",
      name: "Engineering",
      slug: "engineering",
      projects: [
        { id: "proj-1", name: "Web App", slug: "web-app" },
        { id: "proj-2", name: "Batch", slug: "batch" },
      ],
    },
  ],
};

export class FakeOrganizationHost extends OrganizationHostPort {
  readonly downloads: OrganizationDownload[] = [];
  readonly successes: OrganizationSuccessNotice[] = [];
  readonly overlays: { name: string | null; props?: Record<string, unknown> }[] = [];
  readonly failures: OrganizationFailureNotice[] = [];
  readonly navigations: string[] = [];
  readonly queries: Record<string, string | undefined>[] = [];

  constructor(
    private readonly options: {
      scope?: Partial<OrganizationScope>;
      organization?: OrganizationReading | undefined;
      grants?: ReadonlySet<string>;
      query?: Readonly<Record<string, string | undefined>>;
      projectSwitcher?: ReactNode | null;
      currentUser?: OrganizationActor | undefined;
      activeProject?: OrganizationProjectReading | undefined;
      isEnterprise?: boolean;
      isPlanLoading?: boolean;
      hasEmailProvider?: boolean;
      flags?: ReadonlySet<string>;
    } = {},
  ) {
    super();
  }

  scope(): OrganizationScope {
    return {
      organizationId: "org-1",
      projectId: void 0,
      projectSlug: "web-app",
      ...this.options.scope,
    };
  }

  organization(): OrganizationReading | undefined {
    return "organization" in this.options ? this.options.organization : DEFAULT_ORGANIZATION;
  }

  hasPermission(permission: string): boolean {
    return (this.options.grants ?? new Set(["organization:view", "organization:manage"])).has(
      permission,
    );
  }

  /**
   * The settings addresses are all the organization's own, so the fake answers
   * both questions the same way — which is exactly what the browser adapter
   * does, and what makes the port's split a statement about the future rather
   * than about today.
   */
  hasOrganizationPermission(permission: string): boolean {
    return this.hasPermission(permission);
  }

  currentUser(): OrganizationActor | undefined {
    return this.options.currentUser ?? DEFAULT_ACTOR;
  }

  activeProject(): OrganizationProjectReading | undefined {
    return this.options.activeProject;
  }

  isEnterprise(): boolean {
    return this.options.isEnterprise ?? false;
  }

  isPlanLoading(): boolean {
    return this.options.isPlanLoading ?? false;
  }

  hasEmailProvider(): boolean {
    return this.options.hasEmailProvider ?? true;
  }

  isFeatureEnabled(flag: string): boolean {
    return (this.options.flags ?? new Set<string>()).has(flag);
  }

  openOverlay(name: string, props?: Record<string, unknown>): void {
    this.overlays.push({ name, props });
  }

  closeOverlay(): void {
    this.overlays.push({ name: null });
  }

  succeeded(notice: OrganizationSuccessNotice): void {
    this.successes.push(notice);
  }

  route(): OrganizationRouteReading {
    return { params: {}, query: this.options.query ?? {} };
  }

  setQuery(next: Readonly<Record<string, string | undefined>>): void {
    this.queries.push({ ...next });
  }

  projectSwitcher(): ReactNode | null {
    return this.options.projectSwitcher ?? null;
  }

  navigate(to: string): void {
    this.navigations.push(to);
  }

  download(file: OrganizationDownload): void {
    this.downloads.push(file);
  }

  failed(failure: OrganizationFailureNotice): void {
    this.failures.push(failure);
  }
}

/** Renders the screen inside the Design System's provider and a host. */
export function renderWithOrganizationHost(
  element: ReactElement,
  host: FakeOrganizationHost = new FakeOrganizationHost(),
) {
  return {
    host,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <OrganizationHostProvider value={host}>{element}</OrganizationHostProvider>
      </ChakraProvider>,
    ),
  };
}
