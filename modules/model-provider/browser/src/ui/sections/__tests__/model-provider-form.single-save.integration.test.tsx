/**
 * @vitest-environment jsdom
 * Onboarding and the Langy gate save a first provider in one write through the guided form.
 * @see specs/model-providers/onboarding-flow.feature
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
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

import { ModelProviderHostProvider } from "../../../model/model-provider-host.ts";
import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing.tsx";
import { EditModelProviderForm } from "../model-provider-form.tsx";
import { inputFor } from "./model-provider-drawer-harness.tsx";

const TYPED_KEY = "content-marker-key";
const BASE_URL = "https://llm.acme.test/v1";

/** The write count at each moment the form reported the provider saved. */
let savedAfterWrites: number[] = [];

function guidedForm(providerKey: string) {
  return (
    <EditModelProviderForm
      projectId="proj-1"
      organizationId="org-1"
      modelProviderId="new"
      providerKey={providerKey}
      guided
      onSaved={() => savedAfterWrites.push(updateProvider.mock.calls.length)}
      onFailed={vi.fn()}
    />
  );
}

const host = () => new FakeModelProviderHost({ grants: new Set(["organization:manage"]) });

async function connectWith(fields: Record<string, string>) {
  const user = userEvent.setup();
  for (const [label, value] of Object.entries(fields)) {
    await user.type(inputFor(label), value);
  }
  await user.click(screen.getByRole("button", { name: "Connect" }));
  await waitFor(() => expect(savedAfterWrites.length).toBeGreaterThan(0));
}

const writes = () => updateProvider.mock.calls.map(([input]) => input as Record<string, unknown>);
const probes = () => validateApiKey.mock.calls.map(([input]) => input as Record<string, unknown>);

describe("saving a first provider from onboarding or the Langy gate", () => {
  beforeEach(() => {
    validateApiKey.mockReset().mockResolvedValue({ valid: true });
    updateProvider.mockReset().mockResolvedValue({ id: "mp_1" });
    assignRole.mockReset().mockResolvedValue({});
    codex.phase = { name: "idle" };
    listing.rows = [];
    savedAfterWrites = [];
  });

  afterEach(() => cleanup());

  describe("given a new organization with no OpenAI provider", () => {
    describe("when an API key and a base URL are entered and saved", () => {
      /** @scenario "The first save stores the credentials that were entered" */
      it("creates the provider in one write that carries the credentials", async () => {
        renderWithModelProviderHost(guidedForm("openai"), host());

        await connectWith({ OPENAI_API_KEY: TYPED_KEY, OPENAI_BASE_URL: BASE_URL });

        expect(writes()).toHaveLength(1);
        expect(writes()[0]).toMatchObject({
          provider: "openai",
          enabled: true,
          customKeys: { OPENAI_API_KEY: TYPED_KEY, OPENAI_BASE_URL: BASE_URL },
          scopeType: "ORGANIZATION",
        });
      });

      /** @scenario "No enabled provider is ever stored without its credentials" */
      it("never writes an enabled provider that has no credentials", async () => {
        renderWithModelProviderHost(guidedForm("openai"), host());

        await connectWith({ OPENAI_API_KEY: TYPED_KEY, OPENAI_BASE_URL: BASE_URL });

        expect(writes().filter((write) => write.enabled === true && !write.customKeys)).toEqual([]);
      });

      /** @scenario "The step completes only after the credentials are stored" */
      it("reports the provider saved once, after the write that carries the key", async () => {
        renderWithModelProviderHost(guidedForm("openai"), host());

        await connectWith({ OPENAI_API_KEY: TYPED_KEY, OPENAI_BASE_URL: BASE_URL });

        expect(savedAfterWrites).toEqual([1]);
        expect(writes()[0]?.customKeys).toMatchObject({ OPENAI_API_KEY: TYPED_KEY });
      });

      it("probes the same credentials it then saves", async () => {
        renderWithModelProviderHost(guidedForm("openai"), host());

        await connectWith({ OPENAI_API_KEY: TYPED_KEY, OPENAI_BASE_URL: BASE_URL });

        expect(probes()).toHaveLength(1);
        expect(probes()[0]?.customKeys).toMatchObject({
          OPENAI_API_KEY: TYPED_KEY,
          OPENAI_BASE_URL: BASE_URL,
        });
      });
    });
  });

  describe("given the provider form switched from Custom to OpenAI before saving", () => {
    /** @scenario "Switching providers before saving carries nothing over" */
    it("saves the OpenAI key alone, in one write", async () => {
      const fake = host();
      const hosted = (providerKey: string) => (
        <ModelProviderHostProvider value={fake}>
          {guidedForm(providerKey)}
        </ModelProviderHostProvider>
      );
      const view = renderWithModelProviderHost(guidedForm("custom"), fake);
      await userEvent.setup().type(inputFor("CUSTOM_BASE_URL"), "https://stale.acme.test/v1");
      view.rerender(hosted("openai_codex"));
      view.rerender(hosted("openai"));

      await connectWith({ OPENAI_API_KEY: TYPED_KEY });

      expect(writes()).toHaveLength(1);
      expect(writes()[0]).toMatchObject({
        provider: "openai",
        enabled: true,
        customKeys: { OPENAI_API_KEY: TYPED_KEY },
      });
      expect(JSON.stringify(writes())).not.toContain("stale.acme.test");
      expect(JSON.stringify(probes())).not.toContain("stale.acme.test");
    });
  });
});
