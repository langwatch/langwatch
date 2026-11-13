/**
 * Shared doubles for the PII level suites: the api binding built with createApiFixture over one
 * mutable snapshot, a recording host, and the page rendered under Cloud or self-hosted flags.
 */

import {
  UiHostServiceProvider,
  UiHostServicesContextProvider,
  type UiHostServices,
} from "@langwatch/browser-host/capabilities";
import { UiFlagsService, type UiFlags } from "@langwatch/browser-host/feature-flag";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import {
  type DataPrivacyRule,
  type DataPrivacySnapshot,
  type PiiLevel,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { expect, vi } from "vitest";

import type { dataPrivacyApi } from "../../../behavior/data-privacy-api.ts";
import {
  DataPrivacyHostApi,
  DataPrivacyHostProvider,
  type PrivacyFailureNotice,
  type PrivacyHostScope,
  type PrivacyRouteReading,
  type PrivacySuccessNotice,
} from "../../../model/data-privacy-host.ts";

type Api = typeof dataPrivacyApi;
type Procedures = Api["dataPrivacy"];

export const api = {
  snapshot: undefined as DataPrivacySnapshot | undefined,
  invalidate: vi.fn(async () => undefined),
  setForScope: vi.fn(async (_input: unknown) => undefined),
};

/** The binding the screen calls, answering only what the screen uses. */
export function fakeDataPrivacyApi(): Api {
  const procedures = createApiFixture<Procedures>(
    {
      getSnapshot: createApiFixture<Procedures["getSnapshot"]>({
        useQuery: (() => ({ data: api.snapshot, isLoading: false })) as never,
      }),
      setForScope: createApiFixture<Procedures["setForScope"]>({
        useMutation: (() => ({ mutateAsync: api.setForScope, isPending: false })) as never,
      }),
      removeForScope: createApiFixture<Procedures["removeForScope"]>({
        useMutation: (() => ({ mutateAsync: vi.fn(), isPending: false })) as never,
      }),
    },
    "dataPrivacyApi.dataPrivacy",
  );
  return createApiFixture<Api>(
    {
      useUtils: (() => ({ dataPrivacy: { getSnapshot: { invalidate: api.invalidate } } })) as never,
      dataPrivacy: procedures,
    },
    "dataPrivacyApi",
  );
}

function resolved(level: PiiLevel, entities: string[]): ResolvedDataPrivacy {
  return { ...PLATFORM_DEFAULT_DATA_PRIVACY, pii: { level, entities, exceptPatterns: [] } };
}

export function snapshotWith({
  level = "essential",
  entities = [],
  rules = [],
  canWriteOrganization = true,
}: {
  level?: PiiLevel;
  entities?: string[];
  rules?: DataPrivacyRule[];
  canWriteOrganization?: boolean;
} = {}): DataPrivacySnapshot {
  return {
    projectId: "proj-1",
    available: {
      organization: canWriteOrganization ? { id: "org-1", name: "Acme" } : null,
      departments: [],
      teams: [{ id: "team-1", name: "Platform" }],
      projects: [{ id: "proj-1", name: "Web App", teamId: "team-1" }],
    },
    audienceOptions: { groups: [] },
    effective: resolved(level, entities),
    effectiveTeam: resolved(level, entities),
    effectiveOrganization: resolved(level, entities),
    rules,
  };
}

export const organizationRuleWith = (config: DataPrivacyRule["config"]): DataPrivacyRule => ({
  scopeType: "ORGANIZATION",
  scopeId: "org-1",
  name: "Acme",
  personalOnly: false,
  config,
});

export const projectRuleWith = (config: DataPrivacyRule["config"]): DataPrivacyRule => ({
  scopeType: "PROJECT",
  scopeId: "proj-1",
  name: "Web App",
  personalOnly: false,
  config,
});

export class TestPrivacyHost extends DataPrivacyHostApi {
  readonly successes: PrivacySuccessNotice[] = [];
  readonly failures: PrivacyFailureNotice[] = [];

  constructor(private query: Readonly<Record<string, string | undefined>> = {}) {
    super();
  }

  scope(): PrivacyHostScope {
    return { organizationId: "org-1", teamId: "team-1", projectId: "proj-1" };
  }

  route(): PrivacyRouteReading {
    return { params: {}, query: this.query };
  }

  setQuery(next: Readonly<Record<string, string | undefined>>): void {
    this.query = next;
  }

  succeeded(notice: PrivacySuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: PrivacyFailureNotice): void {
    this.failures.push(failure);
  }
}

/** Renders the page; `rerender` renders it again over the current snapshot. */
export function renderScreen({
  screenElement,
  flagOn,
  free = false,
  isSaaS = true,
  query = {},
}: {
  screenElement: ReactElement;
  flagOn: boolean;
  free?: boolean;
  isSaaS?: boolean;
  query?: Record<string, string>;
}) {
  const host = new TestPrivacyHost(query);
  const answers: Record<string, boolean> = {
    release_pii_redaction_model_enabled: flagOn,
    release_pii_redaction_model_free: free,
  };
  const flags: UiFlags = { flag: ({ name }) => answers[name] ?? false };
  const services: UiHostServices = {
    ...createUiHostServicesFromHost({ route: () => ({ params: {}, query }), navigate: () => {} }),
    deployment: {
      isDevelopment: false,
      isSaaS,
      appBaseUrl: "http://localhost",
      hasNlpService: true,
      hasLangevals: true,
      hasEmailProvider: false,
      hasCloudOps: false,
    },
  };
  const tree = () => (
    <UiHostServicesContextProvider value={services}>
      <UiHostServiceProvider value={new Map([[UiFlagsService.name, flags]])}>
        <DataPrivacyHostProvider value={host}>{screenElement}</DataPrivacyHostProvider>
      </UiHostServiceProvider>
    </UiHostServicesContextProvider>
  );
  const result = renderWithDesignSystem(tree());
  return { host, rerender: () => result.rerender(tree()) };
}

export const confirmStrict = async () =>
  userEvent.setup().click(await screen.findByRole("button", { name: "Turn on Strict" }));

export const noPickerOrPrice = () => {
  expect(
    screen.queryByRole("radiogroup", { name: "PII redaction level for this organization" }),
  ).toBeNull();
  expect(screen.queryByText(/\$0\.50/)).toBeNull();
};

export const picker = () =>
  screen.getByRole("radiogroup", { name: "PII redaction level for this organization" });

export const levelRadio = (name: "Essential" | "Strict") =>
  within(picker()).getByRole("radio", { name: new RegExp(`^${name}`) });

/** Ark marks the picked card itself; the hidden native input keeps the last click. */
export const pickedLevel = () =>
  within(picker())
    .getAllByText(/^(Essential|Strict)$/)
    .find((label) => label.getAttribute("data-state") === "checked")?.textContent;

export const effectivePii = () =>
  within(screen.getByRole("table", { name: "Effective privacy settings" }))
    .getByText("PII redaction")
    .closest("tr")?.textContent ?? "";
