/**
 * What an insight test mounts instead of an application: a double for `InsightHostApi`, the
 * design system, and the real tRPC hooks over a transport whose network the test answers.
 * Notices, navigations, query writes and Langy asks are RECORDED, not performed.
 */

import { UiCapabilityContextProvider } from "@langwatch/browser-host/capabilities";
import { type UiLend, uiDeclarations } from "@langwatch/browser-host/declarations";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import { createUiQueryClient } from "@langwatch/browser/query-client";
import { answeringUiTransport, type UiProcedureAnswer } from "@langwatch/browser/testing-transport";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { InsightEntry } from "@langwatch/insight-contract";
import type { LangyAskRequest } from "@langwatch/langy-contract";
import { nowInstant } from "@langwatch/time";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

import { insightApi } from "./behavior/insight-api.ts";
import {
  type InsightFailureNotice,
  InsightHostApi,
  type InsightHostProject,
  InsightHostProvider,
  type InsightSuccessNotice,
} from "./model/insight-host.ts";

export type StubInsightHostOptions = {
  project?: InsightHostProject | undefined;
  /** `release_insights`; on unless a test says otherwise. */
  enabled?: boolean | undefined;
  permissions?: readonly string[];
  query?: Readonly<Record<string, string | undefined>>;
};

/** A host that answers from fixtures and records everything it is told. */
export class StubInsightHost extends InsightHostApi {
  readonly successes: InsightSuccessNotice[] = [];
  readonly failures: InsightFailureNotice[] = [];
  readonly navigations: string[] = [];
  readonly queries: Readonly<Record<string, string | undefined>>[] = [];
  readonly langyAsks: LangyAskRequest[] = [];

  constructor(private readonly options: StubInsightHostOptions = {}) {
    super();
  }

  project(): InsightHostProject | undefined {
    return "project" in this.options ? this.options.project : { id: "project-1", slug: "acme" };
  }

  isEnabled(): boolean | undefined {
    return "enabled" in this.options ? this.options.enabled : true;
  }

  hasPermission(permission: string): boolean {
    return (this.options.permissions ?? ["analytics:view", "analytics:manage"]).includes(
      permission,
    );
  }

  query(): Readonly<Record<string, string | undefined>> {
    return this.queries.at(-1) ?? this.options.query ?? {};
  }

  setQuery(next: Readonly<Record<string, string | undefined>>): void {
    this.queries.push(next);
  }

  navigate(to: string): void {
    this.navigations.push(to);
  }

  succeeded(notice: InsightSuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: InsightFailureNotice): void {
    this.failures.push(failure);
  }

  askLangy(request: LangyAskRequest): void {
    this.langyAsks.push(request);
  }
}

/**
 * Renders one element inside the harness and hands back the host it recorded on. `lends` is
 * what a peer lends by token (§10.1), as an installed analytics would; none unless given.
 */
export function renderWithInsightHost({
  element,
  answer,
  host = new StubInsightHost(),
  lends = [],
}: {
  element: ReactElement;
  answer: UiProcedureAnswer;
  host?: StubInsightHost;
  lends?: readonly UiLend[];
}): RenderResult & { host: StubInsightHost } {
  const queryClient = createUiQueryClient({ onMutationError: () => void 0 });
  const capabilities = {
    ...createUiCapabilitiesFromHost({
      route: () => ({ params: {}, query: {} }),
      navigate: () => void 0,
    }),
    declarations: uiDeclarations([
      { name: "analytics", installation: { capabilities: {}, lends } },
    ]),
  };
  return {
    ...render(
      <DesignSystemProvider forcedTheme="light">
        <UiCapabilityContextProvider value={capabilities}>
          <insightApi.Provider client={answeringUiTransport(answer)} queryClient={queryClient}>
            <InsightHostProvider value={host}>{element}</InsightHostProvider>
          </insightApi.Provider>
        </UiCapabilityContextProvider>
      </DesignSystemProvider>,
    ),
    host,
  };
}

/** An unseen insight filed now that stays true for 7 days; a test overrides what it is about. */
export function insightEntry(overrides: Partial<InsightEntry> = {}): InsightEntry {
  return {
    id: "insight-1",
    title: "Checkout errors doubled",
    body: "Checkout errors doubled overnight.",
    tone: "bad",
    topic: null,
    validDays: 7,
    lwql: null,
    replay: null,
    source: null,
    board: null,
    filedVia: "chat",
    filedByUserId: "user-filer",
    filedAt: nowInstant().epochMilliseconds,
    renewedAt: null,
    seenAt: null,
    archivedAt: null,
    keptAt: null,
    ...overrides,
  };
}
