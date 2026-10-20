// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The inventory's Add and Edit drawers and the once-shown secret dialog, on the shared shapes.
 * Real components over the fake host; only the OTTL editor's tRPC calls are stubbed.
 * @see specs/ai-gateway/governance/ingestion-sources.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";
import {
  type ComposerState,
  SecretModal,
  SourceComposerDrawer,
  SourceEditDrawer,
} from "../governance-inventory.screen.tsx";
import type { Source } from "../ingestion-source-forms.ts";

vi.mock("../../../../behavior/governance-api.ts", () => {
  const api = {
    ingestionSources: {
      ottlStarter: {
        useQuery: () => ({ data: undefined, isLoading: false, error: null }),
      },
      validateOttl: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
          data: undefined,
          error: null,
          reset: vi.fn(),
        }),
      },
    },
  };
  return { api, governanceApi: api };
});

afterEach(cleanup);

const ORG_ID = "org_acme";

const DESTINATION_CTX = {
  organizationId: ORG_ID,
  organizationName: "Acme",
  availableTeams: [],
  availableProjects: [],
};

const source: Source = {
  id: "src_otel",
  organizationId: ORG_ID,
  teamId: null,
  sourceType: "otel_generic",
  name: "Prod OTLP",
  description: null,
  parserConfig: {},
  hasPollerCursor: false,
  pullSchedule: null,
  status: "active",
  traceProjectId: null,
  traceProjectArchived: false,
  lastEventAt: null,
  archivedAt: null,
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
  createdById: null,
  errorCount: 0,
  lastRunCompleteness: null,
  pullStatus: null,
  lastSuccessAt: null,
};

const composer = (name: string): ComposerState => ({
  sourceType: "otel_generic",
  name,
  description: "",
  parserConfig: {},
  ottlStatements: [],
  pullSchedule: "",
  traceProjectId: null,
});

function renderEdit({ name, onClose }: { name?: string; onClose: () => void }) {
  renderWithGovernanceHost(
    <SourceEditDrawer
      organizationId={ORG_ID}
      destinationCtx={DESTINATION_CTX}
      source={{ ...source, name: name ?? source.name }}
      onClose={onClose}
      onSubmit={vi.fn()}
      isPending={false}
    />,
    { host: fakeGovernanceHost() },
  );
}

describe("given the source drawers", () => {
  /** @scenario "The source drawers keep Cancel and say why Save is off" */
  it("draws the logo as decoration beside a title that names the source", async () => {
    renderEdit({ onClose: vi.fn() });

    const heading = await screen.findByRole("heading", { name: /^Edit .*OpenTelemetry/ });
    expect(heading).toBeVisible();
    const glyph = screen.getByTestId("source-type-icon");
    expect(glyph.closest("[aria-hidden]")).not.toBeNull();
  });

  /** @scenario "The source drawers keep Cancel and say why Save is off" */
  it("closes once from Cancel in the Edit drawer", async () => {
    const onClose = vi.fn();
    renderEdit({ onClose });

    await userEvent.setup().click(await screen.findByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /** @scenario "The source drawers keep Cancel and say why Save is off" */
  it("turns Save off with a reason while the name is blank", async () => {
    renderEdit({ name: " ", onClose: vi.fn() });

    const save = await screen.findByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    expect(screen.getByLabelText("Give the source a display name")).toBeTruthy();
  });

  /** @scenario "The source drawers keep Cancel and say why Save is off" */
  it("keeps Create source off with a reason until the Add drawer has a name", async () => {
    const onClose = vi.fn();
    const render = (name: string) => (
      <SourceComposerDrawer
        isOpen
        organizationId={ORG_ID}
        destinationCtx={DESTINATION_CTX}
        composer={composer(name)}
        setComposer={vi.fn()}
        invalidFieldKeys={[]}
        isPending={false}
        onSubmit={vi.fn()}
        onClose={onClose}
      />
    );
    const view = renderWithGovernanceHost(render(""), { host: fakeGovernanceHost() });

    expect(await screen.findByRole("button", { name: "Create source" })).toBeDisabled();
    expect(screen.getByLabelText("Give the source a display name")).toBeTruthy();
    expect(screen.getByTestId("source-type-blurb")).toBeTruthy();

    view.rerender(render("Prod OTLP"));
    expect(screen.getByRole("button", { name: "Create source" })).toBeEnabled();

    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("given a source's secret is shown once", () => {
  const details = {
    title: "Ingest secret for Prod OTLP",
    secret: "lw_is_test_secret",
    sourceId: "src_otel",
    sourceName: "Prod OTLP",
    sourceType: "otel_generic" as const,
  };

  /** @scenario "The once-shown secret ignores an outside click but closes by X or Escape" */
  it("ignores an outside click, then closes by the X and by Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithGovernanceHost(<SecretModal details={details} onClose={onClose} />, {
      host: fakeGovernanceHost(),
    });

    const dialog = await screen.findByRole("dialog", { name: details.title });
    fireEvent.pointerDown(document.body);
    fireEvent.pointerUp(document.body);
    fireEvent.click(document.body);
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  /** @scenario "The once-shown secret ignores an outside click but closes by X or Escape" */
  it("closes from the acknowledgement", async () => {
    const onClose = vi.fn();
    renderWithGovernanceHost(<SecretModal details={details} onClose={onClose} />, {
      host: fakeGovernanceHost(),
    });

    await userEvent.setup().click(await screen.findByRole("button", { name: "I've saved it" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /** @scenario "The secret dialog leads to the source page" */
  it("offers View source page as a real link that navigates through the host on a plain click", async () => {
    const host = fakeGovernanceHost();
    renderWithGovernanceHost(<SecretModal details={details} onClose={vi.fn()} />, { host });

    const link = await screen.findByRole("link", { name: "View source page →" });
    expect(link).toHaveAttribute("href", "/governance/inventory/src_otel");

    await userEvent.setup().click(link);

    expect(host.recording.navigations).toEqual(["/governance/inventory/src_otel"]);
  });

  /** @scenario "The secret dialog leads to the source page" */
  it("leaves a Cmd or Ctrl click on View source page to the browser, so it opens a new tab", async () => {
    const host = fakeGovernanceHost();
    renderWithGovernanceHost(<SecretModal details={details} onClose={vi.fn()} />, { host });
    const link = await screen.findByRole("link", { name: "View source page →" });

    // Runs after the handler: jsdom cannot open a tab, so it only swallows the default.
    const swallow = (event: Event) => event.preventDefault();
    document.addEventListener("click", swallow);

    fireEvent.click(link, { metaKey: true });
    fireEvent.click(link, { ctrlKey: true });
    document.removeEventListener("click", swallow);

    expect(host.recording.navigations).toEqual([]);
  });
});
