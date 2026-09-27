/**
 * @vitest-environment jsdom
 * @see specs/features/onboarding/guided-welcome-takeover.feature
 */
import { findRecommendedChatModels, modelProviders } from "@langwatch/model-provider-contract";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const validateApiKey = vi.fn();
const updateProvider = vi.fn();
const assignRole = vi.fn();
const listing = { rows: [] as unknown[] };
const codex = {
  phase: { name: "idle" } as Record<string, unknown>,
  begin: vi.fn(),
  cancel: vi.fn(),
};

vi.mock("../../../behavior/use-codex-device-sign-in.ts", () => ({
  useCodexDeviceSignIn: () => ({
    phase: codex.phase,
    connected: null,
    storedProviderId: null,
    disconnecting: false,
    begin: codex.begin,
    cancel: codex.cancel,
    disconnect: vi.fn(),
  }),
}));

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn(), openDrawer: vi.fn() }),
}));

vi.mock("@langwatch/browser-host/feature-flag", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

vi.mock("../../../behavior/use-model-providers-settings.ts", () => ({
  useModelProvidersSettings: () => ({
    providers: {},
    modelMetadata: {},
    isLoading: false,
    refetch: vi.fn(),
    hasEnabledProviders: false,
  }),
}));

vi.mock("../../../behavior/model-provider-api.ts", () => {
  const query = (data: unknown) => ({
    useQuery: () => ({ data, isLoading: false, isSuccess: true, refetch: vi.fn() }),
  });
  const mutation = (mutateAsync: (...args: unknown[]) => unknown) => ({
    useMutation: () => ({ mutateAsync, mutate: vi.fn(), isPending: false }),
  });
  const modelProvider = {
    isManagedProvider: query({ managed: false }),
    listAllForOrganizationForFrontend: {
      useQuery: () => ({ data: listing.rows, isLoading: false, isSuccess: true, refetch: vi.fn() }),
    },
    listAllForProjectForFrontend: {
      useQuery: () => ({ data: listing.rows, isLoading: false, isSuccess: true, refetch: vi.fn() }),
    },
    codexStatus: query(undefined),
    codexSignInStart: mutation(vi.fn()),
    codexSignInPoll: mutation(vi.fn()),
    delete: mutation(vi.fn()),
    update: mutation((...args) => updateProvider(...args)),
    validateApiKey: mutation((...args) => validateApiKey(...args)),
    setRoleAssignmentForScope: mutation((...args) => assignRole(...args)),
  };
  const invalidate = () => Promise.resolve();
  const queries = new Proxy({}, { get: () => ({ invalidate }) });
  const useUtils = () => ({ modelProvider: queries });
  return {
    modelProviderApi: { useUtils, modelProvider },
    api: { useUtils, modelProvider },
  };
});

import { describeRefusal } from "../../../model/connection-verdict-copy.ts";
import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing.tsx";
import { EditModelProviderForm } from "../model-provider-form.tsx";
import { inputFor, keyedRow } from "./model-provider-drawer-harness.tsx";

function renderGuided(providerKey: string, onSaved = vi.fn()) {
  renderWithModelProviderHost(
    <EditModelProviderForm
      projectId="proj-1"
      organizationId="org-1"
      modelProviderId="new"
      providerKey={providerKey}
      guided
      onSaved={onSaved}
    />,
    new FakeModelProviderHost({ grants: new Set(["organization:manage"]) }),
  );
  return { onSaved };
}

describe("the shared provider form in its guided presentation", () => {
  beforeEach(() => {
    validateApiKey.mockReset().mockResolvedValue({ valid: true });
    updateProvider.mockReset().mockResolvedValue({});
    assignRole.mockReset().mockResolvedValue({});
    codex.phase = { name: "idle" };
    listing.rows = [];
    codex.begin.mockReset();
    codex.cancel.mockReset();
  });

  afterEach(() => cleanup());

  describe("when Codex is the selected provider", () => {
    /** @scenario "The provider marks are one row with Codex first and preselected" */
    it("offers Sign in with ChatGPT", () => {
      renderGuided("openai_codex");

      expect(screen.getByRole("button", { name: "Sign in with ChatGPT" })).toBeInTheDocument();
    });
  });

  describe("when an API key provider is selected", () => {
    /** @scenario "An API key provider asks for the key and offers the default chat models" */
    it("asks for the key, offers the recommended model first and waits for a key", async () => {
      renderGuided("openai");
      const [recommended] = findRecommendedChatModels({ provider: "openai", limit: 4 });

      const pills = within(screen.getByRole("group", { name: "Default chat model" })).getAllByRole(
        "button",
      );
      expect(pills).toHaveLength(4);
      expect(pills[0]).toHaveTextContent(`${recommended}recommended`);
      expect(pills[0]).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();

      await userEvent.setup().type(inputFor("OPENAI_API_KEY"), "sk-typed");

      expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
    });
  });

  describe("when a provider without a model list is selected", () => {
    /** @scenario "Azure, Bedrock and Custom take credentials and a typed model name" */
    it.each(["azure", "bedrock", "custom"] as const)("hints %s's model is typed", (key) => {
      renderGuided(key);

      expect(
        screen.getByText(
          `Type it exactly as deployed: ${modelProviders[key].name} has no model list we can read for you.`,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "Default chat model" })).toBeNull();
    });
  });

  describe("when a typed key is connected", () => {
    /** @scenario "Connecting with a key checks it and then reports Connected" */
    it("reads Checking the key… while checking, then Connected with the picked model", async () => {
      let settle: (value: { valid: boolean }) => void = () => {};
      validateApiKey.mockReturnValue(new Promise((resolve) => (settle = resolve)));
      const { onSaved } = renderGuided("openai");
      const [recommended] = findRecommendedChatModels({ provider: "openai", limit: 4 });
      const user = userEvent.setup();

      await user.type(inputFor("OPENAI_API_KEY"), "sk-typed");
      await user.click(screen.getByRole("button", { name: "Connect" }));

      expect(await screen.findByRole("button", { name: "Checking the key…" })).toBeDisabled();
      settle({ valid: true });

      expect(await screen.findByRole("button", { name: "Connected" })).toBeDisabled();
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ chatModel: recommended }));
    });
  });

  describe("when the provider refuses the typed key", () => {
    const refusal = { code: "provider_key_invalid" };
    let user: ReturnType<typeof userEvent.setup>;

    beforeEach(async () => {
      validateApiKey.mockResolvedValue({ valid: false, domainError: refusal });
      renderGuided("openai");
      user = userEvent.setup();

      await user.type(inputFor("OPENAI_API_KEY"), "sk-refused");
      await user.click(screen.getByRole("button", { name: "Connect" }));
    });

    /** @scenario "A rejected key shows the named error on the field" */
    it("shows the registry's words for the refusal and saves nothing", async () => {
      expect(await screen.findByText(describeRefusal(refusal))).toBeInTheDocument();
      expect(updateProvider).not.toHaveBeenCalled();
    });

    /** @scenario "A refused key stays in the field for the user to fix" */
    it("keeps the refused key in the field across a refresh", async () => {
      await screen.findByText(describeRefusal(refusal));
      listing.rows = [];
      await user.click(screen.getAllByRole("button", { pressed: false })[0] as HTMLElement);

      expect(inputFor("OPENAI_API_KEY")).toHaveValue("sk-refused");
    });
  });

  describe("when a key is connected with the recommended model kept", () => {
    /** @scenario "A connected provider is saved at the organization and becomes Langy's model" */
    it("saves at the organization and makes the pick the Default model", async () => {
      renderGuided("openai");
      const [recommended] = findRecommendedChatModels({ provider: "openai", limit: 4 });
      const user = userEvent.setup();

      await user.type(inputFor("OPENAI_API_KEY"), "sk-typed");
      await user.click(screen.getByRole("button", { name: "Connect" }));

      await screen.findByRole("button", { name: "Connected" });
      expect(updateProvider).toHaveBeenCalledWith(
        expect.objectContaining({ scopeType: "ORGANIZATION" }),
      );
      expect(assignRole).toHaveBeenCalledWith(
        expect.objectContaining({ scopeType: "ORGANIZATION", model: `openai/${recommended}` }),
      );
    });
  });

  describe("when the Codex sign-in is waiting for approval", () => {
    /** @scenario "The pending Codex sign-in shows the code with a copy button and a Cancel on the status row" */
    it("shows the code with copy and link on one row, and a status with Cancel", async () => {
      codex.phase = {
        name: "pending",
        userCode: "ABCD-1234",
        verificationUrl: "https://auth.openai.com/codex/device",
      };
      renderGuided("openai_codex");
      const user = userEvent.setup();

      expect(screen.getByText("Waiting for ChatGPT…").closest("button")).toBeNull();
      expect(
        screen.getByText("Enter this code on OpenAI's device page to approve the sign-in:"),
      ).toBeInTheDocument();
      const row = screen.getByLabelText("One-time sign-in code").parentElement as HTMLElement;
      expect(within(row).getByRole("link", { name: /Open openai.com/ })).toBeInTheDocument();

      await user.click(within(row).getByRole("button", { name: "Copy code" }));
      expect(await navigator.clipboard.readText()).toBe("ABCD-1234");
      expect(await within(row).findByRole("button", { name: "Code copied" })).toBeInTheDocument();

      const status = screen.getByText("Waiting for ChatGPT…").parentElement as HTMLElement;
      await user.click(within(status).getByRole("button", { name: "Cancel" }));
      expect(codex.cancel).toHaveBeenCalled();
    });
  });

  describe("when the Codex sign-in is not approved in time", () => {
    /** @scenario "A Codex sign-in that times out says so and lets the user try again" */
    it("says it timed out and starts again", async () => {
      codex.phase = {
        name: "error",
        message: "The sign-in timed out before it was approved.",
        timedOut: true,
      };
      renderGuided("openai_codex");

      expect(screen.getByText("The sign-in timed out before it was approved.")).toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole("button", { name: "Start sign-in again" }));
      expect(codex.begin).toHaveBeenCalled();
    });
  });

  describe("when the server carries a key for the provider in its environment", () => {
    /** @scenario "A key already set on the server is used unless the user pastes their own" */
    it("edits the stored row, says so, and keeps the server's key when none is pasted", async () => {
      listing.rows = [
        {
          ...keyedRow({
            providerKey: "openai",
            apiKey: "OPENAI_API_KEY",
            baseUrl: "OPENAI_BASE_URL",
          }),
          id: "row-openai-environment",
          customKeys: null,
          scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
        },
      ];
      renderGuided("openai");

      expect(screen.getByTestId("environment-key-hint")).toHaveTextContent(
        `This server already has a key for ${modelProviders.openai.name}. Connect to use it, or paste your own.`,
      );
      await userEvent.setup().click(screen.getByRole("button", { name: "Connect" }));

      await screen.findByRole("button", { name: "Connected" });
      expect(validateApiKey).not.toHaveBeenCalled();
      expect(updateProvider).toHaveBeenCalledWith(
        expect.objectContaining({ id: "row-openai-environment", customKeys: undefined }),
      );
    });
  });
});
