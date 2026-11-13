/**
 * @vitest-environment jsdom
 * The organization's Essential or Strict picker, behind release_pii_redaction_model_enabled.
 * Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */

import { UiHostServiceProvider } from "@langwatch/browser-host/capabilities";
import { UiFlagsService, type UiFlags } from "@langwatch/browser-host/feature-flag";
import {
  type DataPrivacyRule,
  type DataPrivacySnapshot,
  type PiiLevel,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DataPrivacyHostApi,
  DataPrivacyHostProvider,
  type PrivacyFailureNotice,
  type PrivacyHostScope,
  type PrivacyRouteReading,
  type PrivacySuccessNotice,
} from "../../../model/data-privacy-host.ts";
import DataPrivacyScreen from "../data-privacy-screen.tsx";

const { state, invalidate, setForScope } = vi.hoisted(() => ({
  state: { snapshot: undefined as unknown },
  invalidate: vi.fn(async () => undefined),
  setForScope: vi.fn(async (_input: unknown) => undefined),
}));

vi.mock("../../../behavior/data-privacy-api.ts", () => ({
  dataPrivacyApi: {
    useUtils: () => ({ dataPrivacy: { getSnapshot: { invalidate } } }),
    dataPrivacy: {
      getSnapshot: { useQuery: () => ({ data: state.snapshot, isLoading: false }) },
      removeForScope: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      setForScope: { useMutation: () => ({ mutateAsync: setForScope, isPending: false }) },
    },
  },
}));

function resolved(level: PiiLevel): ResolvedDataPrivacy {
  return { ...PLATFORM_DEFAULT_DATA_PRIVACY, pii: { level, entities: [], exceptPatterns: [] } };
}

function snapshotWith({
  level = "essential",
  rules = [],
  canWriteOrganization = true,
}: {
  level?: PiiLevel;
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
    effective: resolved(level),
    effectiveTeam: resolved(level),
    effectiveOrganization: resolved(level),
    rules,
  };
}

const organizationRuleWith = (config: DataPrivacyRule["config"]): DataPrivacyRule => ({
  scopeType: "ORGANIZATION",
  scopeId: "org-1",
  name: "Acme",
  personalOnly: false,
  config,
});

class TestPrivacyHost extends DataPrivacyHostApi {
  readonly successes: PrivacySuccessNotice[] = [];
  readonly failures: PrivacyFailureNotice[] = [];

  scope(): PrivacyHostScope {
    return { organizationId: "org-1", teamId: "team-1", projectId: "proj-1" };
  }

  route(): PrivacyRouteReading {
    return { params: {}, query: {} };
  }

  setQuery(): void {}

  succeeded(notice: PrivacySuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: PrivacyFailureNotice): void {
    this.failures.push(failure);
  }
}

function renderScreen({ flagOn }: { flagOn: boolean }) {
  const host = new TestPrivacyHost();
  const flags: UiFlags = {
    flag: ({ name }) => (name === "release_pii_redaction_model_enabled" ? flagOn : false),
  };
  renderWithDesignSystem(
    <UiHostServiceProvider value={new Map([[UiFlagsService.name, flags]])}>
      <DataPrivacyHostProvider value={host}>
        <DataPrivacyScreen />
      </DataPrivacyHostProvider>
    </UiHostServiceProvider>,
  );
  return host;
}

const picker = () =>
  screen.getByRole("radiogroup", { name: "PII redaction level for this organization" });
const levelRadio = (name: "Essential" | "Strict") =>
  within(picker()).getByRole("radio", { name: new RegExp(`^${name}`) });
/** Ark marks the picked card itself; the hidden native input keeps the last click. */
const pickedLevel = () =>
  within(picker())
    .getAllByText(/^(Essential|Strict)$/)
    .find((label) => label.getAttribute("data-state") === "checked")?.textContent;
const effectivePii = () =>
  within(screen.getByRole("table", { name: "Effective privacy settings" }))
    .getByText("PII redaction")
    .closest("tr")?.textContent ?? "";

describe("given the Data Privacy page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.snapshot = snapshotWith();
  });

  describe("when release_pii_redaction_model_enabled is off for the organization", () => {
    /** @scenario Without the flag the page offers no level picker and no price */
    it("shows no picker, no price, no model and the summary as before", () => {
      renderScreen({ flagOn: false });

      expect(
        screen.queryByRole("radiogroup", { name: "PII redaction level for this organization" }),
      ).toBeNull();
      expect(screen.queryByText(/LangWatch PII Redaction Model/)).toBeNull();
      expect(screen.queryByText(/\$0\.50/)).toBeNull();
      expect(effectivePii()).toBe("PII redactionEssential");
    });
  });

  describe("when the flag is on and the organization resolves to Essential", () => {
    /** @scenario With the flag the page offers Essential and Strict for the organization */
    it("shows Essential picked, included, and Strict as the model with its price", () => {
      renderScreen({ flagOn: true });

      expect(levelRadio("Essential")).toBeChecked();
      expect(levelRadio("Strict")).not.toBeChecked();
      const cards = within(picker());
      expect(cards.getByText("Included")).toBeInTheDocument();
      expect(cards.getByText("Standard detection")).toBeInTheDocument();
      expect(cards.getByText("LangWatch PII Redaction Model")).toBeInTheDocument();
      expect(screen.getByTestId("pii-redaction-model-price").textContent).toContain(
        "$0.50per 1M characters, pay as you go",
      );
    });

    /** @scenario The example follows the selected level */
    it("shows what Essential stores, with the name and the address as sent", () => {
      renderScreen({ flagOn: true });

      expect(screen.getByText("What Essential stores, on a synthetic span")).toBeInTheDocument();
      const stored = screen.getByTestId("pii-example-essential").textContent;
      expect(stored).toContain("Daniel Okafor");
      expect(stored).toContain("42 Larkspur Lane, Apt 7, Springfield");
      expect(stored).toContain("[EMAIL]");
      expect(screen.queryByTestId("pii-example-strict")).toBeNull();
    });
  });

  describe("when an admin picks Strict over an organization rule that drops input", () => {
    /** @scenario Picking Strict writes the organization rule and shows Strict's example */
    it("saves the organization rule at strict, keeps the drop and shows Strict's example", async () => {
      state.snapshot = snapshotWith({
        rules: [organizationRuleWith({ categories: { input: { disposition: "drop" } } })],
      });
      const host = renderScreen({ flagOn: true });

      await userEvent.setup().click(levelRadio("Strict"));

      await waitFor(() => expect(setForScope).toHaveBeenCalledTimes(1));
      expect(setForScope).toHaveBeenCalledWith({
        projectId: "proj-1",
        scope: { scopeType: "ORGANIZATION", scopeId: "org-1" },
        personalOnly: false,
        config: { categories: { input: { disposition: "drop" } }, pii: { level: "strict" } },
      });
      expect(levelRadio("Strict")).toBeChecked();
      const stored = screen.getByTestId("pii-example-strict").textContent;
      expect(stored).toContain("[NAME]");
      expect(stored).toContain("[ADDRESS]");
      expect(stored).not.toContain("Daniel Okafor");
      await waitFor(() => expect(invalidate).toHaveBeenCalled());
      expect(host.successes.at(-1)?.title).toBe("Organization on Strict");
    });
  });

  describe("when an admin picks Essential on a Strict organization", () => {
    /** @scenario Picking Essential on a Strict organization writes Essential back */
    it("saves the organization rule at essential", async () => {
      state.snapshot = snapshotWith({
        level: "strict",
        rules: [organizationRuleWith({ pii: { level: "strict" } })],
      });
      renderScreen({ flagOn: true });

      await userEvent.setup().click(levelRadio("Essential"));

      await waitFor(() =>
        expect(setForScope).toHaveBeenCalledWith(
          expect.objectContaining({ config: { pii: { level: "essential" } } }),
        ),
      );
    });
  });

  describe("when saving the organization rule fails", () => {
    /** @scenario A failed save tells the admin and keeps the level that was stored */
    it("hands the raw error to the host and shows Essential again", async () => {
      const boom = new Error("nope");
      setForScope.mockRejectedValueOnce(boom);
      const host = renderScreen({ flagOn: true });

      await userEvent.setup().click(levelRadio("Strict"));

      await waitFor(() => expect(host.failures).toHaveLength(1));
      expect(host.failures[0]).toEqual({
        error: boom,
        fallbackTitle: "Couldn't change the organization's PII level",
      });
      await waitFor(() => expect(pickedLevel()).toBe("Essential"));
    });
  });

  describe("when the caller cannot write a rule at the organization scope", () => {
    /** @scenario A member who cannot write the organization rule sees the picker read-only */
    it("disables both levels", () => {
      state.snapshot = snapshotWith({ canWriteOrganization: false });
      renderScreen({ flagOn: true });

      expect(levelRadio("Essential")).toBeDisabled();
      expect(levelRadio("Strict")).toBeDisabled();
    });
  });

  describe("when an admin opens the information beside Strict's price", () => {
    /** @scenario The billing and fallback small print sits behind the price */
    it("says only Strict spans are billed and when a span falls back", async () => {
      renderScreen({ flagOn: true });

      await userEvent.setup().hover(screen.getByRole("button", { name: "How Strict is billed" }));

      expect(
        await screen.findByText(
          "Pay as you go, no quota or plan. Only Strict spans are billed; Essential stays included.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Strict falls back to the standard detector for a span when the model is unavailable or the span is over 8,000 characters.",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("when the flag is on and the organization resolves to Strict", () => {
    /** @scenario With the flag the effective summary names what runs the level */
    it("names the model in the effective summary", () => {
      state.snapshot = snapshotWith({ level: "strict" });
      renderScreen({ flagOn: true });

      expect(effectivePii()).toBe("PII redactionStrict · LangWatch PII Redaction Model");
    });
  });
});
