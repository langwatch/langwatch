/**
 * What this package's suites mount a screen inside.
 *
 * The host port is an abstract class, so a test constructs one rather than
 * mocking a module: the fake below RECORDS what a screen asked the application
 * to do — which query it wrote, which drawer it addressed, what it reported,
 * what it copied, and every CLI device-flow call it made — which is exactly the
 * surface the real adapter answers. The same shape `@langwatch/gateway-web`'s
 * `testing.tsx` introduced.
 *
 * THE DEVICE-FLOW CALLS ARE PROGRAMMABLE, not stubbed to one answer: the four
 * lookup outcomes and the two approve outcomes each drive a different screen,
 * and a fake that could only answer "pending" would leave the expired card, the
 * unrecognised-code card and the refusal card untested.
 *
 * Not exported from the package. A test imports it relatively; nothing outside
 * this package has any business constructing a host.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  ApiKeyHostPort,
  ApiKeyHostProvider,
  type ApiKeyActor,
  type ApiKeyAvailableScopes,
  type ApiKeyFailureNotice,
  type ApiKeyHostScope,
  type ApiKeyOrganization,
  type ApiKeyPlatformDrawer,
  type ApiKeyRouteReading,
  type ApiKeySessionStatus,
  type ApiKeySuccessNotice,
  type CliDeviceActionResult,
  type CliDeviceApproval,
  type CliDeviceCodeLookup,
} from "./model/api-key-host";

/** One recorded `openPlatformDrawer` call. */
export type RecordedDrawerOpen = {
  drawer: ApiKeyPlatformDrawer;
  params: Readonly<Record<string, string | undefined>>;
};

/** One recorded clipboard write. */
export type RecordedCopy = { text: string; succeeded: ApiKeySuccessNotice };

export class FakeApiKeyHost extends ApiKeyHostPort {
  readonly queryWrites: Array<Readonly<Record<string, string | undefined>>> = [];
  readonly drawerOpens: RecordedDrawerOpen[] = [];
  readonly successes: ApiKeySuccessNotice[] = [];
  readonly failures: ApiKeyFailureNotice[] = [];
  readonly copies: RecordedCopy[] = [];
  readonly navigations: Array<{ kind: "navigate" | "replace"; to: string }> = [];
  readonly leadSources: string[] = [];
  readonly lookups: string[] = [];
  readonly approvals: CliDeviceApproval[] = [];
  readonly denials: string[] = [];

  constructor(
    private readonly options: {
      scope?: Partial<ApiKeyHostScope>;
      grants?: ReadonlySet<string>;
      availableScopes?: ApiKeyAvailableScopes;
      organizations?: ApiKeyOrganization[] | undefined;
      currentUser?: ApiKeyActor;
      sessionStatus?: ApiKeySessionStatus;
      apiEndpoint?: string;
      query?: Readonly<Record<string, string | undefined>>;
      fragment?: string;
      copySucceeds?: boolean;
      lookup?: CliDeviceCodeLookup;
      approve?: CliDeviceActionResult;
      deny?: CliDeviceActionResult;
    } = {},
  ) {
    super();
  }

  scope(): ApiKeyHostScope {
    return {
      organizationId: "org-1",
      organizationName: "ACME",
      teamId: "team-1",
      projectId: "proj-1",
      projectName: "Web App",
      projectSlug: "web-app",
      projectApiKey: void 0,
      ...this.options.scope,
    };
  }

  hasPermission(permission: string): boolean {
    return (this.options.grants ?? new Set(["project:manage", "organization:view"])).has(
      permission,
    );
  }

  availableScopes(): ApiKeyAvailableScopes {
    return (
      this.options.availableScopes ?? {
        organization: { id: "org-1", name: "ACME" },
        teams: [{ id: "team-1", name: "Platform" }],
        projects: [{ id: "proj-1", name: "Web App", teamId: "team-1" }],
      }
    );
  }

  organizations(): ApiKeyOrganization[] | undefined {
    return this.options.organizations;
  }

  currentUser(): ApiKeyActor {
    return this.options.currentUser ?? { id: "user-1" };
  }

  sessionStatus(): ApiKeySessionStatus {
    return this.options.sessionStatus ?? "authenticated";
  }

  apiEndpoint(): string {
    return this.options.apiEndpoint ?? "https://app.langwatch.ai";
  }

  route(): ApiKeyRouteReading {
    return {
      params: {},
      query: this.options.query ?? {},
      fragment: this.options.fragment ?? "",
    };
  }

  setQuery(next: Readonly<Record<string, string | undefined>>): void {
    this.queryWrites.push(next);
  }

  replace(to: string): void {
    this.navigations.push({ kind: "replace", to });
  }

  navigate(to: string): void {
    this.navigations.push({ kind: "navigate", to });
  }

  succeeded(notice: ApiKeySuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: ApiKeyFailureNotice): void {
    this.failures.push(failure);
  }

  copyToClipboard(request: { text: string; succeeded: ApiKeySuccessNotice }): Promise<boolean> {
    this.copies.push(request);
    return Promise.resolve(this.options.copySucceeds ?? true);
  }

  recordLeadSourceIfAbsent(source: string): void {
    this.leadSources.push(source);
  }

  openPlatformDrawer(request: {
    drawer: ApiKeyPlatformDrawer;
    params?: Readonly<Record<string, string | undefined>>;
  }): void {
    this.drawerOpens.push({ drawer: request.drawer, params: request.params ?? {} });
  }

  lookupDeviceCode(userCode: string): Promise<CliDeviceCodeLookup> {
    this.lookups.push(userCode);
    return Promise.resolve(
      this.options.lookup ?? {
        outcome: "pending",
        userCode,
        status: "pending",
        expiresAt: Date.now() + 10 * 60_000,
        credentialType: "device_session",
      },
    );
  }

  approveDeviceCode(approval: CliDeviceApproval): Promise<CliDeviceActionResult> {
    this.approvals.push(approval);
    return Promise.resolve(this.options.approve ?? { outcome: "ok" });
  }

  denyDeviceCode(userCode: string): Promise<CliDeviceActionResult> {
    this.denials.push(userCode);
    return Promise.resolve(this.options.deny ?? { outcome: "ok" });
  }
}

/** Renders a screen inside the Design System's provider and a host. */
export function renderWithApiKeyHost(
  element: ReactElement,
  host: FakeApiKeyHost = new FakeApiKeyHost(),
) {
  return {
    host,
    ...render(
      <ChakraProvider value={defaultSystem}>
        <ApiKeyHostProvider value={host}>{element}</ApiKeyHostProvider>
      </ChakraProvider>,
    ),
  };
}
