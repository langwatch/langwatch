/**
 * @vitest-environment jsdom
 *
 * The same escape hatch as the settings drawer, on the surface the customer
 * report actually points at. This component is the onboarding step and the
 * "Langy needs a model to get started" gate, and it hard-blocked on a refused
 * key with no way past — the onboarding step at least has "Skip for now", the
 * Langy gate has nothing. The reporter's words were "doesn't allow me to
 * continue", and the handler here is literally `handleSaveAndContinue`.
 *
 * It is also stricter than the drawer: it probes on every save rather than
 * only when a new key was typed, so a stored key the provider has since
 * started refusing blocks unrelated edits too.
 *
 * Covers @integration scenarios from
 * specs/model-providers/credential-validation.feature.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSubmit,
  mockSetEnabled,
  mockValidateApiKey,
  mockValidateWithCustomUrl,
  mockClearError,
  mockCustomKeys,
} = vi.hoisted(() => ({
  mockSubmit: vi.fn().mockResolvedValue({}),
  mockSetEnabled: vi.fn().mockResolvedValue({}),
  mockValidateApiKey: vi.fn().mockResolvedValue(true),
  mockValidateWithCustomUrl: vi.fn().mockResolvedValue(true),
  // Stable across renders on purpose: the component clears its field errors in
  // an effect keyed on this callback, so a fresh function per render re-runs
  // the effect, sets state, and renders forever.
  mockClearError: vi.fn(),
  mockCustomKeys: { current: {} as Record<string, string> },
}));

vi.mock("../../../../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", name: "Web App", slug: "web-app" },
    team: { id: "team-1", name: "Platform" },
    organization: { id: "org-1", name: "Acme" },
    hasPermission: () => true,
  }),
}));

vi.mock("../../../../../../hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => ({ providers: void 0, isLoading: false }),
}));

/**
 * The form state is stubbed so the test drives the one decision under
 * examination — whether a refusal gates the save — rather than the whole
 * credential-entry flow. `setCustomKey` is what the key field writes through,
 * and the fingerprint the gate compares is taken from these values, so
 * changing a key here re-arms the probe exactly as typing does.
 */
vi.mock("../../../../../../hooks/useModelProviderForm", () => {
  // Every field held by reference for the same reason as `clearError` above:
  // this component keys effects and memos on them.
  const actions = {
    setCustomKey: (key: string, value: string) => {
      mockCustomKeys.current = { ...mockCustomKeys.current, [key]: value };
    },
    setEnabled: mockSetEnabled,
    submit: mockSubmit,
    setManaged: () => undefined,
  };
  const initialKeys = {};
  const displayKeys = { OPENAI_API_KEY: "" };
  const scopes = [{ scopeType: "ORGANIZATION", scopeId: "org-1" }];
  const errors = {};

  return {
    useModelProviderForm: () => [
      {
        customKeys: mockCustomKeys.current,
        initialKeys,
        displayKeys,
        scopes,
        errors,
        isSaving: false,
        isDirty: true,
        useApiGateway: false,
      },
      actions,
    ],
  };
});

vi.mock("../../../../../../hooks/useModelProviderApiKeyValidation", () => ({
  useModelProviderApiKeyValidation: () => ({
    validate: mockValidateApiKey,
    validateWithCustomUrl: mockValidateWithCustomUrl,
    isValidating: false,
    validationError: undefined,
    clearError: mockClearError,
  }),
}));

vi.mock("../../../../../../utils/api", () => ({
  api: {
    modelProvider: {
      isManagedProvider: { useQuery: () => ({ data: { managed: false } }) },
    },
    useUtils: () => ({}),
  },
}));

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { MASKED_KEY_PLACEHOLDER } from "../../../../../../utils/constants";
import { ModelProviderSetup } from "../ModelProviderSetup";

const renderSetup = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      {/* The onboarding registry keys OpenAI as `open_ai`; the backend key is
          `openai`. The Langy variant is the surface with no way to skip. */}
      <ModelProviderSetup modelProviderKey="open_ai" variant="langy" />
    </ChakraProvider>,
  );

const saveButton = () =>
  screen.getByRole("button", { name: /^save( anyway)?$/i });

describe("Feature: a refused API key is not a dead end during onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCustomKeys.current = { OPENAI_API_KEY: "sk-the-customers-key" };
    mockSubmit.mockResolvedValue({});
    mockSetEnabled.mockResolvedValue({});
    mockValidateApiKey.mockResolvedValue(true);
    mockValidateWithCustomUrl.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the provider refuses the key the customer entered", () => {
    describe("when they save once", () => {
      /** @scenario A refused key can still be saved */
      it("holds the save back and offers to save anyway", async () => {
        mockValidateApiKey.mockResolvedValue(false);
        mockValidateWithCustomUrl.mockResolvedValue(false);
        renderSetup();
        const user = userEvent.setup();

        await user.click(saveButton());

        await waitFor(() => {
          expect(saveButton()).toHaveTextContent(/save anyway/i);
        });
        expect(mockSubmit).not.toHaveBeenCalled();
      });
    });

    describe("when they save a second time", () => {
      /** @scenario Saving anyway keeps the credential I entered */
      it("lets the step continue without probing again", async () => {
        mockValidateApiKey.mockResolvedValue(false);
        mockValidateWithCustomUrl.mockResolvedValue(false);
        renderSetup();
        const user = userEvent.setup();

        await user.click(saveButton());
        await waitFor(() => {
          expect(saveButton()).toHaveTextContent(/save anyway/i);
        });

        const probesBefore =
          mockValidateApiKey.mock.calls.length +
          mockValidateWithCustomUrl.mock.calls.length;

        await user.click(saveButton());

        await waitFor(() => {
          expect(mockSubmit).toHaveBeenCalledTimes(1);
        });
        // The second save is the customer overriding the refusal, not a retry.
        expect(
          mockValidateApiKey.mock.calls.length +
            mockValidateWithCustomUrl.mock.calls.length,
        ).toBe(probesBefore);
      });
    });
  });

  describe("given the provider accepts the key", () => {
    describe("when they save", () => {
      it("continues on the first click with no override offered", async () => {
        renderSetup();
        const user = userEvent.setup();

        await user.click(saveButton());

        await waitFor(() => {
          expect(mockSubmit).toHaveBeenCalledTimes(1);
        });
        expect(saveButton()).toHaveTextContent(/^save$/i);
      });
    });
  });

  describe("given a stored key the customer has not touched", () => {
    describe("when they save an unrelated change", () => {
      /**
       * Re-probing on every save makes picking a model depend on third-party
       * uptime, and blocks it entirely behind a key that has drifted
       * out-of-band. The settings drawer already only probes a key the
       * customer actually typed.
       */
      it("saves without asking the provider anything", async () => {
        // The masked placeholder is what a stored key looks like in the form;
        // nothing here has been typed over.
        mockCustomKeys.current = {
          OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
        };
        renderSetup();
        const user = userEvent.setup();

        await user.click(saveButton());

        await waitFor(() => {
          expect(mockSubmit).toHaveBeenCalledTimes(1);
        });
        expect(mockValidateApiKey).not.toHaveBeenCalled();
        expect(mockValidateWithCustomUrl).not.toHaveBeenCalled();
      });
    });
  });
});
