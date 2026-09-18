/**
 * Recovered from the deleted `modelProviderDrawerHarness.tsx`, adapted to the current
 * `ModelProviderListEntry` wire shape. Not exported — a test imports it relatively.
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
 * per-provider-type record from `useModelProvidersSettings` (mocked, since
 * its real form reaches a `workflow-web` boundary), and the flat list.
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
 * `CredentialsSection` labels each input with a plain `Text` (no
 * `htmlFor`/`id`), so `getByLabelText` can't find it. Walk up to the first
 * ancestor with an `<input>` descendant and return that input.
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
    throw new Error(`expected exactly one input near label "${labelText}", found ${inputs.length}`);
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
 * Chakra's `Field.RequiredIndicator` renders `aria-hidden="true"` only when
 * the enclosing `Field.Root` is `required`, rendering nothing otherwise —
 * so its presence in the field's wrapper is the required marker.
 */
export function isMarkedRequired(labelText: string): boolean {
  const wrapper = fieldWrapper(labelText);
  const indicator = wrapper.querySelector('[aria-hidden="true"]');
  return indicator?.textContent === "*";
}
