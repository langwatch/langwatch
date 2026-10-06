/**
 * @vitest-environment jsdom
 *
 * The onboarding step and the "Langy needs a model to get started" gate save a
 * provider through the real form hook. Everything below the tRPC boundary is
 * stood in for by a small in-memory store that behaves like the server: a
 * write without an `id` creates a row, and the provider list re-reads it.
 *
 * Covers @integration scenarios from
 * specs/model-providers/onboarding-flow.feature.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type UpdateInput = Record<string, unknown> & {
  id?: string;
  provider: string;
  enabled: boolean;
  customKeys?: Record<string, unknown> | null;
  scopes?: Array<{ scopeType: string; scopeId: string }>;
};

const server = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = {
    providers: {} as Record<string, unknown>,
    data: { providers: {} as Record<string, unknown>, modelMetadata: {} },
    updates: [] as Array<Record<string, unknown>>,
    completedAfterWrites: [] as number[],
    probes: [] as Array<Record<string, unknown>>,
    nextId: 1,
  };
  return {
    state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify: () => {
      for (const listener of listeners) listener();
    },
    reset: () => {
      state.providers = {};
      state.data = { providers: {}, modelMetadata: {} };
      state.updates = [];
      state.completedAfterWrites = [];
      state.probes = [];
      state.nextId = 1;
    },
  };
});

/** What `modelProvider.update` does with a write, reduced to what the form reads back. */
async function applyUpdate(input: UpdateInput) {
  server.state.updates.push(structuredClone(input));
  const existing = Object.values(server.state.providers).find(
    (row) => (row as { id: string }).id === input.id,
  ) as Record<string, unknown> | undefined;
  const row = {
    ...(existing ?? {}),
    id: existing?.id ?? `mp_${server.state.nextId++}`,
    provider: input.provider,
    enabled: input.enabled,
    customKeys:
      input.customKeys === undefined
        ? (existing?.customKeys ?? null)
        : input.customKeys,
    scopes:
      input.scopes ??
      existing?.scopes ??
      (input.projectId
        ? [{ scopeType: "PROJECT", scopeId: input.projectId }]
        : []),
    models: null,
    embeddingsModels: null,
    deploymentMapping: null,
    extraHeaders: [],
  };
  server.state.providers = {
    ...server.state.providers,
    [`${input.provider}:${row.id}`]: row,
  };
  // The list is keyed by provider on the wire.
  server.state.data = {
    providers: Object.fromEntries(
      Object.values(server.state.providers).map((stored) => [
        (stored as { provider: string }).provider,
        stored,
      ]),
    ),
    modelMetadata: {},
  };
  return row;
}

vi.mock("../../../../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", name: "Web App", slug: "web-app" },
    team: { id: "team-1", name: "Platform" },
    organization: { id: "org-1", name: "Acme" },
    hasPermission: () => true,
  }),
}));

vi.mock("../../../../../../utils/api", () => {
  const invalidate = async () => {
    server.notify();
  };
  const utils = {
    modelProvider: {
      getAllForProject: { invalidate },
      getAllForProjectForFrontend: { invalidate },
      listAllForProjectForFrontend: { invalidate },
      listAllForOrganizationForFrontend: { invalidate },
      getResolvedDefault: { invalidate },
      getDefaultModelsForProject: { invalidate },
      validateKeyWithCustomUrl: { fetch: async () => ({ valid: true }) },
    },
  };
  const update = { mutateAsync: applyUpdate };
  const refetch = async () => undefined;
  const setRole = { mutateAsync: async () => ({}) };
  const validate = {
    mutateAsync: async (input: Record<string, unknown>) => {
      server.state.probes.push(structuredClone(input));
      return { valid: true };
    },
  };
  return {
    api: {
      useUtils: () => utils,
      modelProvider: {
        update: { useMutation: () => update },
        setRoleAssignmentForScope: { useMutation: () => setRole },
        validateApiKey: { useMutation: () => validate },
        isManagedProvider: { useQuery: () => ({ data: { managed: false } }) },
        getAllForProjectForFrontend: {
          useQuery: () => {
            // Same identity until a write lands, as a query cache gives.
            const data = useSyncExternalStore(
              server.subscribe,
              () => server.state.data,
            );
            return { data, isLoading: false, refetch };
          },
        },
      },
    },
  };
});

vi.mock("../../../../../../utils/modelProviderSync", async (original) => ({
  ...(await original<
    typeof import("../../../../../../utils/modelProviderSync")
  >()),
  broadcastModelProvidersUpdated: () => undefined,
}));

vi.mock("../../../../../../components/settings/CodexSignIn", () => ({
  CodexSignIn: () => <div data-testid="codex-sign-in" />,
}));

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { ModelProviderScreen } from "../../ModelProviderScreen";
import { ModelProviderSetup } from "../ModelProviderSetup";

const renderSetup = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <ModelProviderSetup
        modelProviderKey="open_ai"
        variant="langy"
        onComplete={() => {
          server.state.completedAfterWrites.push(server.state.updates.length);
        }}
      />
    </ChakraProvider>,
  );

const TYPED_KEY = "sk-test-key";
const BASE_URL = "https://llm.acme.test/v1";

async function fillAndSave() {
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText(/OpenAI API Key/, { selector: "input" }),
    TYPED_KEY,
  );
  await user.type(
    screen.getByLabelText(/OpenAI Base URL/, { selector: "input" }),
    BASE_URL,
  );
  await user.click(screen.getByRole("button", { name: /^save$/i }));
  await waitFor(() => {
    expect(server.state.completedAfterWrites.length).toBeGreaterThan(0);
  });
  await settleQueuedWrites();
}

/**
 * The stand-in server answers without timers, so one turn of the task queue
 * runs every promise chain a save started, including a write queued behind
 * the completion callback.
 */
async function settleQueuedWrites() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("Feature: saving a first provider from onboarding or the Langy gate", () => {
  beforeEach(() => {
    server.reset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a new organization with no OpenAI provider", () => {
    describe("when an API key and a base URL are entered and saved", () => {
      /** @scenario The first save stores the credentials that were entered */
      it("creates the provider in one write that carries the credentials", async () => {
        renderSetup();

        await fillAndSave();

        expect(server.state.updates).toHaveLength(1);
        expect(server.state.updates[0]).toMatchObject({
          provider: "openai",
          enabled: true,
          customKeys: {
            OPENAI_API_KEY: TYPED_KEY,
            OPENAI_BASE_URL: BASE_URL,
          },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
        });
      });

      /** @scenario No enabled provider is ever stored without its credentials */
      it("never writes an enabled provider that has no credentials", async () => {
        renderSetup();

        await fillAndSave();

        const keyless = server.state.updates.filter(
          (update) => update.enabled === true && !update.customKeys,
        );
        expect(keyless).toEqual([]);
      });

      /** @scenario The step completes only after the credentials are stored */
      it("reports completion only after the credentials are stored", async () => {
        renderSetup();

        await fillAndSave();

        expect(server.state.completedAfterWrites).toEqual([1]);
        const stored = Object.values(server.state.providers) as Array<{
          customKeys: Record<string, unknown> | null;
        }>;
        expect(stored).toHaveLength(1);
        expect(stored[0]!.customKeys).toMatchObject({
          OPENAI_API_KEY: TYPED_KEY,
        });
      });

      it("probes the same credentials it then saves", async () => {
        renderSetup();

        await fillAndSave();

        expect(server.state.probes).toHaveLength(1);
        expect(server.state.probes[0]!.customKeys).toMatchObject({
          OPENAI_API_KEY: TYPED_KEY,
          OPENAI_BASE_URL: BASE_URL,
        });
      });
    });
  });

  describe("given the provider grid in the Langy panel", () => {
    describe("when Custom, then Codex, then OpenAI are picked and only the OpenAI key is typed", () => {
      /** @scenario Switching providers before saving carries nothing over */
      it("saves the OpenAI key alone, in one write", async () => {
        const user = userEvent.setup();
        render(
          <ChakraProvider value={defaultSystem}>
            <ModelProviderScreen
              variant="langy"
              onComplete={() => {
                server.state.completedAfterWrites.push(
                  server.state.updates.length,
                );
              }}
            />
          </ChakraProvider>,
        );

        const tile = (label: string) =>
          document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
        await user.click(tile("Custom, OpenAI-compatible"));
        const customInputs = Array.from(document.querySelectorAll("input"));
        await user.type(customInputs[1]!, "https://stale.acme.test/v1");
        await user.click(tile("Codex (OpenAI account)"));
        await user.click(tile("OpenAI"));

        await user.type(
          screen.getByLabelText(/OpenAI API Key/, { selector: "input" }),
          TYPED_KEY,
        );
        await user.click(screen.getByRole("button", { name: /^save$/i }));
        await waitFor(() => {
          expect(server.state.completedAfterWrites.length).toBeGreaterThan(0);
        });
        await settleQueuedWrites();

        // An untouched optional field travels as an empty string, not as a
        // value left behind by another provider's form.
        expect(server.state.probes.map((probe) => probe.customKeys)).toEqual([
          { OPENAI_API_KEY: TYPED_KEY, OPENAI_BASE_URL: "" },
        ]);
        expect(server.state.updates).toHaveLength(1);
        expect(server.state.updates[0]).toMatchObject({
          provider: "openai",
          enabled: true,
          customKeys: { OPENAI_API_KEY: TYPED_KEY },
        });
        expect(JSON.stringify(server.state.updates)).not.toContain(
          "stale.acme.test",
        );
        expect(JSON.stringify(server.state.probes)).not.toContain(
          "stale.acme.test",
        );
      });
    });
  });
});
