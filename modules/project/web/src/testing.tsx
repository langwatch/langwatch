/**
 * Test utilities for mounting the project settings screen inside a host port.
 * The fake host records what the screen asks the application to do and answers
 * grants, plan role, and flags.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import {
  ProjectHostApi,
  ProjectHostProvider,
  type ProjectFailureNotice,
  type ProjectHostOrganization,
  type ProjectHostProject,
  type ProjectSuccessNotice,
} from "./model/project-host.ts";

export const anOrganization = (
  overrides: Partial<ProjectHostOrganization> = {},
): ProjectHostOrganization => ({
  id: "org-1",
  name: "Acme",
  slug: "acme",
  useCustomS3: false,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  s3Bucket: null,
  presenceEnabled: true,
  traceSharingEnabled: true,
  supportContact: null,
  primaryIntent: null,
  teams: [{ id: "team-1", name: "Engineering", slug: "engineering", isPersonal: false }],
  ...overrides,
});

export const aProject = (overrides: Partial<ProjectHostProject> = {}): ProjectHostProject => ({
  id: "project-1",
  name: "Checkout assistant",
  slug: "checkout-assistant",
  language: "python",
  framework: "openai",
  userLinkTemplate: null,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  s3Bucket: null,
  traceSharingEnabled: true,
  presenceEnabled: true,
  isPersonal: false,
  firstMessage: true,
  ...overrides,
});

export class FakeProjectHost extends ProjectHostApi {
  readonly successes: ProjectSuccessNotice[] = [];
  readonly failures: ProjectFailureNotice[] = [];
  readonly overlays: { name: string; props?: Record<string, unknown> }[] = [];

  constructor(
    private readonly options: {
      organization?: ProjectHostOrganization | null;
      project?: ProjectHostProject | null;
      permissions?: readonly string[];
      isLiteMember?: boolean;
      flags?: readonly string[];
      projectSwitcher?: ReactNode;
    } = {},
  ) {
    super();
  }

  organization(): ProjectHostOrganization | undefined {
    if (this.options.organization === null) return void 0;
    return this.options.organization ?? anOrganization();
  }

  project(): ProjectHostProject | undefined {
    if (this.options.project === null) return void 0;
    return this.options.project ?? aProject();
  }

  hasPermission(permission: string): boolean {
    return (
      this.options.permissions ?? ["organization:view", "organization:manage", "project:update"]
    ).includes(permission);
  }

  isLiteMember(): boolean {
    return this.options.isLiteMember ?? false;
  }

  isFeatureEnabled(flag: string): boolean {
    return (this.options.flags ?? ["release_ui_ai_governance_enabled"]).includes(flag);
  }

  projectSwitcher(): ReactNode | null {
    return this.options.projectSwitcher ?? null;
  }

  openOverlay(name: string, props?: Record<string, unknown>): void {
    this.overlays.push(props ? { name, props } : { name });
  }

  succeeded(notice: ProjectSuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: ProjectFailureNotice): void {
    this.failures.push(failure);
  }
}

/** Renders the screen inside the Design System's provider and a host. */
export function renderWithProjectHost(
  element: ReactElement,
  host: FakeProjectHost = new FakeProjectHost(),
) {
  return {
    host,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <ProjectHostProvider value={host}>{element}</ProjectHostProvider>
      </ChakraProvider>,
    ),
  };
}
