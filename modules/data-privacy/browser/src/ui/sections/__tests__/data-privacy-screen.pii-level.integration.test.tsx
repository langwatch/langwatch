/**
 * @vitest-environment jsdom
 * The organization's Essential or Strict picker, behind release_pii_redaction_model_enabled.
 * Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
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

function resolved(level: PiiLevel, entities: string[] = []): ResolvedDataPrivacy {
  return { ...PLATFORM_DEFAULT_DATA_PRIVACY, pii: { level, entities, exceptPatterns: [] } };
}

function snapshotWith({
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

function renderScreen({
  flagOn,
  free = false,
  isSaaS = true,
}: {
  flagOn: boolean;
  free?: boolean;
  isSaaS?: boolean;
}) {
  const host = new TestPrivacyHost();
  const answers: Record<string, boolean> = {
    release_pii_redaction_model_enabled: flagOn,
    release_pii_redaction_model_free: free,
  };
  const flags: UiFlags = { flag: ({ name }) => answers[name] ?? false };

  const services: UiHostServices = {
    ...createUiHostServicesFromHost({
      route: () => ({ params: {}, query: {} }),
      navigate: () => {},
    }),
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
  renderWithDesignSystem(
    <UiHostServicesContextProvider value={services}>
      <UiHostServiceProvider value={new Map([[UiFlagsService.name, flags]])}>
        <DataPrivacyHostProvider value={host}>
          <DataPrivacyScreen />
        </DataPrivacyHostProvider>
      </UiHostServiceProvider>
    </UiHostServicesContextProvider>,
  );
  return host;
}

const confirmStrict = async () =>
  userEvent.setup().click(await screen.findByRole("button", { name: "Turn on Strict" }));
const noModelOrPrice = () => {
  expect(
    screen.queryByRole("radiogroup", { name: "PII redaction level for this organization" }),
  ).toBeNull();
  expect(screen.queryByText(/LangWatch PII Redaction Model/)).toBeNull();
  expect(screen.queryByText(/\$0\.50/)).toBeNull();
};

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

      noModelOrPrice();
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
      await confirmStrict();

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
      await confirmStrict();

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
          "Pay as you go, no quota or plan. Only spans the model redacts are billed; spans that fall back to the standard detector are free. Essential stays included.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Strict falls back to the standard detector for a span when the model is unavailable or the span's text is very long (over 8,000 characters in total).",
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

  describe("when an admin picks Strict and then cancels", () => {
    /** @scenario Turning on Strict asks to confirm with the price */
    it("asks with the model and its price and saves nothing on cancel", async () => {
      renderScreen({ flagOn: true });
      const user = userEvent.setup();

      await user.click(levelRadio("Strict"));

      const dialog = await screen.findByRole("dialog", { name: "Turn on Strict?" });
      expect(dialog.textContent).toContain(
        "Strict uses the LangWatch PII Redaction Model at $0.50 per 1M characters, pay as you go. Turn it on?",
      );
      expect(setForScope).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(setForScope).not.toHaveBeenCalled();
      expect(pickedLevel()).toBe("Essential");
    });
  });

  describe("when the organization is on the free list", () => {
    /** @scenario A free organization sees Strict as included and turns it on without a price */
    it("shows Strict as included and saves it without asking", async () => {
      renderScreen({ flagOn: true, free: true });

      expect(screen.getByTestId("pii-redaction-model-price").textContent).toBe(
        "Includedfor your organization",
      );
      expect(screen.queryByText(/\$0\.50/)).toBeNull();

      await userEvent.setup().click(levelRadio("Strict"));

      await waitFor(() =>
        expect(setForScope).toHaveBeenCalledWith(
          expect.objectContaining({ config: { pii: { level: "strict" } } }),
        ),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByText(/billed from the next trace/)).toBeNull();
    });
  });

  describe("when the organization is on Custom", () => {
    /** @scenario An organization on Custom sees its level and confirms replacing it */
    it("names Custom, picks neither level and asks before replacing it", async () => {
      state.snapshot = snapshotWith({
        level: "custom",
        entities: ["PERSON", "EMAIL_ADDRESS"],
        rules: [
          organizationRuleWith({ pii: { level: "custom", entities: ["EMAIL_ADDRESS", "PERSON"] } }),
        ],
      });
      renderScreen({ flagOn: true });
      const user = userEvent.setup();

      expect(screen.getByText("Organization on Custom (2 types)")).toBeInTheDocument();
      expect(pickedLevel()).toBeUndefined();

      await user.click(levelRadio("Essential"));
      const dialog = await screen.findByRole("dialog", { name: "Replace custom PII settings?" });
      expect(dialog.textContent).toContain(
        "This replaces your custom PII settings with Essential.",
      );
      expect(setForScope).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole("button", { name: "Replace" }));

      await waitFor(() =>
        expect(setForScope).toHaveBeenCalledWith(
          expect.objectContaining({ config: { pii: { level: "essential" } } }),
        ),
      );
    });
  });

  describe("when the organization has PII redaction off", () => {
    /** @scenario An organization with PII redaction off sees its level */
    it("names Off and picks neither level", () => {
      state.snapshot = snapshotWith({ level: "disabled" });
      renderScreen({ flagOn: true });

      expect(screen.getByText("Organization on Off")).toBeInTheDocument();
      expect(pickedLevel()).toBeUndefined();
    });
  });

  describe("when the deployment is self-hosted", () => {
    /** @scenario A self-hosted deployment shows no model and no price */
    it("shows no picker, model or price even with the flag on", () => {
      renderScreen({ flagOn: true, isSaaS: false });

      noModelOrPrice();
      expect(effectivePii()).toBe("PII redactionEssential");
    });
  });
});
