/**
 * @vitest-environment jsdom
 *
 * The connect machinery behind the guided provider panel: the shared
 * provider form saves the row at the organization, Langy's role points at
 * the picked model, the organization records the connection, and a refused
 * key saves nothing.
 *
 * Spec: specs/features/onboarding/guided-welcome-takeover.feature
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the providers query returns; a test swaps it to simulate a refetch. */
const providersState: { current: Record<string, unknown> } = { current: {} };
vi.mock("~/hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => ({
    providers: providersState.current,
    isLoading: false,
  }),
}));

const formParams: { current: Record<string, unknown> } = { current: {} };
const setEnabled = vi.fn(async () => {});
const setProjectDefaultModel = vi.fn();
const setUseAsDefaultProvider = vi.fn();
const setCustomModels = vi.fn();
const submit = vi.fn(async () => {});
vi.mock("~/hooks/useModelProviderForm", () => ({
  useModelProviderForm: (params: Record<string, unknown>) => {
    formParams.current = params;
    const [customKeys, setCustomKeys] = useState<Record<string, string>>({});
    return [
      { customKeys, scopes: [] },
      {
        setCustomKey: (key: string, value: string) =>
          setCustomKeys((v) => ({ ...v, [key]: value })),
        setProjectDefaultModel,
        setUseAsDefaultProvider,
        setCustomModels,
        setEnabled,
        submit: async () => {
          await submit();
          (params.onSuccess as () => void)();
        },
      },
    ];
  },
}));

const validation: {
  validate: ReturnType<typeof vi.fn>;
  validationError?: string;
  validationErrorCode?: string;
} = { validate: vi.fn() };
vi.mock("~/hooks/useModelProviderApiKeyValidation", () => ({
  useModelProviderApiKeyValidation: () => ({
    validate: validation.validate,
    isValidating: false,
    validationError: validation.validationError,
    validationErrorCode: validation.validationErrorCode,
    clearError: vi.fn(),
  }),
}));

const recordRefusal = vi.fn();
const clearRefusal = vi.fn();
vi.mock("~/hooks/useCredentialProbeGate", () => ({
  useCredentialProbeGate: () => ({
    probeRequired: true,
    recordRefusal,
    clearRefusal,
  }),
}));

const setRoleAssignment = vi.fn(async () => ({}));
const recordProvider = vi.fn(async () => ({}));
vi.mock("~/utils/api", () => ({
  api: {
    modelProvider: {
      setRoleAssignmentForScope: {
        useMutation: () => ({ mutateAsync: setRoleAssignment }),
      },
    },
    onboarding: {
      recordProvider: { useMutation: () => ({ mutateAsync: recordProvider }) },
    },
  },
}));

import { MASKED_KEY_PLACEHOLDER } from "~/utils/constants";
import { GUIDED_PROVIDERS, registrySpecFor } from "../providers";
import { useGuidedProviderConnect } from "../useGuidedProviderConnect";

const openai = GUIDED_PROVIDERS.find((p) => p.id === "openai")!;
const custom = GUIDED_PROVIDERS.find((p) => p.id === "custom")!;

function renderConnect(provider = openai) {
  const onConnected = vi.fn();
  const onFailed = vi.fn();
  const hook = renderHook(() =>
    useGuidedProviderConnect({
      provider,
      projectId: "proj_1",
      organizationId: "org_1",
      onConnected,
      onFailed,
    }),
  );
  return { ...hook, onConnected, onFailed };
}

afterEach(cleanup);

describe("useGuidedProviderConnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providersState.current = {};
    validation.validate = vi.fn(async () => true);
    delete validation.validationError;
    delete validation.validationErrorCode;
  });

  describe("when the providers query refetches after the key check", () => {
    /** @scenario A refused key stays in the field for the user to fix */
    it("keeps handing the form the same provider, so the typed key survives", () => {
      const storedRow = () => ({
        provider: "openai",
        enabled: false,
        customKeys: null,
        models: null,
        embeddingsModels: null,
        disabledByDefault: true,
        deploymentMapping: null,
        extraHeaders: [],
      });
      providersState.current = { openai: storedRow() };
      const { result, rerender } = renderConnect();
      const before = formParams.current.provider;
      act(() => {
        result.current.setField("OPENAI_API_KEY", "sk-typed-1234");
      });
      // A refetch: equal content, fresh objects and arrays.
      providersState.current = { openai: storedRow() };
      rerender();
      expect(formParams.current.provider).toBe(before);
      expect(result.current.values.OPENAI_API_KEY).toBe("sk-typed-1234");
    });
  });

  describe("when the stored row changes after the list loads", () => {
    /** @scenario "A connected provider is saved at the organization and becomes Langy's model" */
    it("applies the picked model to the form again, since the form clears it on a row change", () => {
      const { result, rerender } = renderConnect();
      const model = result.current.models[0]!;
      const calls = setProjectDefaultModel.mock.calls.length;
      // The list finishes loading: the row the form was handed is replaced.
      providersState.current = {
        openai: {
          provider: "openai",
          enabled: true,
          customKeys: null,
          models: null,
          embeddingsModels: null,
          disabledByDefault: false,
          deploymentMapping: null,
          extraHeaders: [],
        },
      };
      rerender();
      expect(setProjectDefaultModel.mock.calls.length).toBeGreaterThan(calls);
      expect(setProjectDefaultModel).toHaveBeenLastCalledWith(
        `openai/${model}`,
      );
      expect(setUseAsDefaultProvider).toHaveBeenLastCalledWith(true);
    });
  });

  describe("when the server carries the key in its environment", () => {
    /** @scenario A key already set on the server is used unless the user pastes their own */
    it("reports the environment key while the field holds the mask", () => {
      providersState.current = {
        openai: {
          provider: "openai",
          enabled: true,
          customKeys: null,
          models: null,
          embeddingsModels: null,
          disabledByDefault: false,
          deploymentMapping: null,
          extraHeaders: [],
        },
      };
      const { result } = renderConnect();
      expect(formParams.current.isUsingEnvVars).toBe(true);
      act(() => {
        result.current.setField("OPENAI_API_KEY", MASKED_KEY_PLACEHOLDER);
      });
      expect(result.current.usesEnvironmentKey).toBe(true);
      expect(result.current.ready).toBe(true);
      act(() => {
        result.current.setField("OPENAI_API_KEY", "sk-mine-1234");
      });
      expect(result.current.usesEnvironmentKey).toBe(false);
    });
  });

  describe("when a valid key is connected with the recommended model", () => {
    /** @scenario "A connected provider is saved at the organization and becomes Langy's model" */
    it("saves the row for the organization, points Default and Langy at the model and records it", async () => {
      const { result, onConnected } = renderConnect();
      const backendKey = registrySpecFor(openai).backendModelProviderKey;
      const model = result.current.models[0]!;
      expect(result.current.model).toBe(model);
      expect(result.current.ready).toBe(false);

      // The person who just created the organization administers it: the
      // form saves at the organization scope.
      expect(formParams.current).toMatchObject({
        organizationId: "org_1",
        projectId: "proj_1",
        canManageOrganization: true,
      });
      expect(setProjectDefaultModel).toHaveBeenCalledWith(
        `${backendKey}/${model}`,
      );
      // The form only replays the Default role with the pick when the
      // provider is marked as the default one.
      expect(setUseAsDefaultProvider).toHaveBeenCalledWith(true);

      act(() => {
        result.current.setField("OPENAI_API_KEY", "sk-test-1234");
      });
      expect(result.current.ready).toBe(true);

      await act(async () => {
        await result.current.connect();
      });

      expect(validation.validate).toHaveBeenCalledTimes(1);
      expect(clearRefusal).toHaveBeenCalledTimes(1);
      // The form's submit writes the row as enabled; a separate toggle would
      // save (and fire the success path) before the key is on the row.
      expect(setEnabled).not.toHaveBeenCalled();
      expect(submit).toHaveBeenCalledTimes(1);
      expect(setRoleAssignment).toHaveBeenCalledWith({
        scopeType: "ORGANIZATION",
        scopeId: "org_1",
        role: "LANGY",
        model: `${backendKey}/${model}`,
      });
      expect(recordProvider).toHaveBeenCalledWith({
        organizationId: "org_1",
        provider: backendKey,
        model,
      });
      expect(result.current.status).toBe("connected");
      expect(onConnected).toHaveBeenCalledWith({
        provider: backendKey,
        model,
        kind: "api-key",
      });
    });
  });

  describe("when the provider refuses the key", () => {
    /** @scenario "A rejected key shows the named error on the field" */
    it("keeps the refusal on the field and saves nothing", async () => {
      validation.validate = vi.fn(async () => false);
      validation.validationError = "OpenAI rejected this API key.";
      validation.validationErrorCode = "model_provider_key_rejected";
      const { result, onConnected, onFailed } = renderConnect();
      act(() => {
        result.current.setField("OPENAI_API_KEY", "sk-bad-1234");
      });
      await act(async () => {
        await result.current.connect();
      });

      expect(recordRefusal).toHaveBeenCalledTimes(1);
      expect(setEnabled).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
      expect(setRoleAssignment).not.toHaveBeenCalled();
      expect(recordProvider).not.toHaveBeenCalled();
      expect(onConnected).not.toHaveBeenCalled();
      expect(onFailed).toHaveBeenCalledWith({
        provider: "openai",
        code: "model_provider_key_rejected",
      });
      expect(result.current.status).toBe("idle");
      expect(result.current.error).toBe("OpenAI rejected this API key.");
    });
  });

  describe("when a provider with no model list is used", () => {
    it("registers the typed model as the provider's chat model and waits for it", () => {
      const { result } = renderConnect(custom);
      expect(result.current.models).toEqual([]);
      act(() => {
        result.current.setField("CUSTOM_BASE_URL", "https://llm.acme.dev/v1");
      });
      expect(result.current.ready).toBe(false);
      act(() => {
        result.current.setManualModel("acme-llm-large");
      });
      expect(result.current.ready).toBe(true);
      expect(setCustomModels).toHaveBeenCalledWith([
        {
          modelId: "acme-llm-large",
          displayName: "acme-llm-large",
          mode: "chat",
        },
      ]);
      expect(setProjectDefaultModel).toHaveBeenCalledWith(
        "custom/acme-llm-large",
      );
    });
  });
});
