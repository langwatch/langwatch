/**
 * Shared render + query helpers for the EditModelProviderForm integration
 * suites in this directory.
 *
 * RECOVERED FROM the deleted
 * `platform/app/src/components/settings/__tests__/modelProviderDrawerHarness.tsx`,
 * adapted to the current `ModelProviderListEntry` wire shape and the
 * package-local `../../../behavior/model-provider-api` boundary (the old
 * harness mocked `~/utils/api`'s collapsed + flat-list queries against
 * `MaybeStoredModelProvider`).
 *
 * Not exported from the package — a test imports it relatively.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { MASKED_KEY_PLACEHOLDER } from "@langwatch/model-provider-contract";
import type { ModelProviderListEntry } from "@langwatch/model-provider-contract";

export const SELF_HOSTED_URL = "https://llm.internal.acme.example/v1";

export const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/** Providers whose registry schema accepts either an API key or a base URL. */
export const eitherOrProviders = [
  { providerKey: "openai", apiKey: "OPENAI_API_KEY", baseUrl: "OPENAI_BASE_URL" },
  { providerKey: "anthropic", apiKey: "ANTHROPIC_API_KEY", baseUrl: "ANTHROPIC_BASE_URL" },
] as const;

/** Builds one stored row for the flat provider list, keyed by scope. */
export function keyedRow({
  providerKey,
  apiKey,
  baseUrl,
  storedBaseUrl,
}: {
  providerKey: string;
  apiKey: string;
  baseUrl: string;
  storedBaseUrl?: string;
}): ModelProviderListEntry {
  return {
    id: `row-${providerKey}`,
    provider: providerKey,
    name: providerKey,
    enabled: true,
    disabledAt: null,
    healthStatus: null,
    customKeys: {
      [apiKey]: MASKED_KEY_PLACEHOLDER,
      [baseUrl]: storedBaseUrl ?? "",
    },
    deploymentMapping: null,
    scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
    models: null,
    embeddingsModels: null,
    customModels: [],
    customEmbeddingsModels: [],
  };
}

/**
 * Wires the two sources `EditModelProviderForm` reads: the collapsed
 * per-provider-type record `useModelProvidersSettings` hands back (mocked
 * directly — its own real implementation reaches a `workflow-web` studio-host
 * boundary this suite has no business asserting on), and the flat list
 * `useAllModelProvidersList` reads through `model-provider-api`'s
 * `listAllFor{Organization,Project}ForFrontend` queries.
 */
export function makePrimeQueries({
  providersSettingsMock,
  organizationListQuery,
  projectListQuery,
}: {
  providersSettingsMock: ReturnType<typeof vi.fn>;
  organizationListQuery: ReturnType<typeof vi.fn>;
  projectListQuery: ReturnType<typeof vi.fn>;
}) {
  return (rows: ModelProviderListEntry[]) => {
    const collapsed: Record<string, ModelProviderListEntry> = {};
    for (const row of rows) {
      collapsed[row.provider] = row;
    }
    providersSettingsMock.mockReturnValue({
      providers: collapsed,
      modelMetadata: {},
      isLoading: false,
      refetch: vi.fn(),
      hasEnabledProviders: Object.values(collapsed).some((row) => row.enabled),
    });
    const flat = {
      data: rows,
      isLoading: false,
      isSuccess: true,
      isError: false,
      refetch: vi.fn(),
    };
    organizationListQuery.mockReturnValue(flat);
    projectListQuery.mockReturnValue(flat);
  };
}

/**
 * `CredentialsSection` labels each credential input with a plain `Text`
 * (no `htmlFor`/`id` association), so `getByLabelText` can't find it.
 * Walk up from the label text node to the first ancestor that contains
 * an `<input>` descendant (the field's own wrapper) and return that input.
 */
export function inputFor(labelText: string): HTMLInputElement {
  const label = screen.getByText(labelText);
  let node: HTMLElement | null = label;
  while (node && !node.querySelector("input")) {
    node = node.parentElement;
  }
  if (!node) {
    throw new Error(`no input found near label "${labelText}"`);
  }
  const inputs = node.querySelectorAll("input");
  if (inputs.length !== 1) {
    throw new Error(
      `expected exactly one input near label "${labelText}", found ${inputs.length}`,
    );
  }
  return inputs[0] as HTMLInputElement;
}

/** The field's own wrapper — same walk `inputFor` does, minus the input. */
export function fieldWrapper(labelText: string): HTMLElement {
  const label = screen.getByText(labelText);
  let node: HTMLElement | null = label;
  while (node && !node.querySelector("input")) {
    node = node.parentElement;
  }
  if (!node) {
    throw new Error(`no field wrapper found near label "${labelText}"`);
  }
  return node;
}

/**
 * Chakra's `Field.RequiredIndicator` renders `aria-hidden="true"` (default
 * children `"*"`) only when the enclosing `Field.Root` is `required`, and
 * renders nothing at all otherwise — so its presence in the field's own
 * wrapper is the required marker.
 */
export function isMarkedRequired(labelText: string): boolean {
  const wrapper = fieldWrapper(labelText);
  const indicator = wrapper.querySelector('[aria-hidden="true"]');
  return indicator?.textContent === "*";
}
