/**
 * Shared harness for the model-provider drawer integration tests.
 *
 * Holds everything that is not a behaviour assertion: the Chakra wrapper,
 * the provider-row fixture, the query priming, and the DOM readers for a
 * credential field. The `vi.mock` calls stay in each test file, since they
 * have to hoist above that file's own imports.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";

import type { MaybeStoredModelProvider } from "../../../server/modelProviders/registry";
import { MASKED_KEY_PLACEHOLDER } from "../../../utils/constants";

export const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

export const SELF_HOSTED_URL = "https://llm.acme.internal/v1";

/**
 * Providers whose schema accepts one credential in place of another. The
 * rule belongs to the shape, not to openai, so the drawer is driven for
 * every provider that carries it — a fourth one joins by adding a row.
 */
export const eitherOrProviders = [
  {
    providerKey: "openai",
    apiKey: "OPENAI_API_KEY",
    baseUrl: "OPENAI_BASE_URL",
  },
  {
    providerKey: "anthropic",
    apiKey: "ANTHROPIC_API_KEY",
    baseUrl: "ANTHROPIC_BASE_URL",
  },
];

/** A saved provider whose API key is already on file. */
export function keyedRow({
  providerKey,
  apiKey,
  baseUrl,
  storedBaseUrl = "",
}: {
  providerKey: string;
  apiKey: string;
  baseUrl: string;
  storedBaseUrl?: string;
}): MaybeStoredModelProvider {
  return {
    id: `row-${providerKey}`,
    name: providerKey,
    provider: providerKey,
    enabled: true,
    // Stored keys reach the browser masked, never in plaintext.
    customKeys: {
      [apiKey]: MASKED_KEY_PLACEHOLDER,
      [baseUrl]: storedBaseUrl,
    },
    models: null,
    embeddingsModels: null,
    customModels: null,
    customEmbeddingsModels: null,
    disabledByDefault: false,
    deploymentMapping: null,
    extraHeaders: [],
    scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
    scopeType: "PROJECT",
    scopeId: "proj-1",
  };
}

function readyQueryResult<T>(data: T) {
  return {
    data,
    isSuccess: true,
    isError: false,
    isLoading: false,
    status: "success" as const,
    refetch: vi.fn(),
  };
}

/**
 * Builds the `primeQueries(rows)` used by a test file, bound to that file's
 * own query mocks: the collapsed record the settings page reads and the two
 * flat lists the drawer resolves its row from.
 */
export function makePrimeQueries({
  collapsedQuery,
  organizationListQuery,
  projectListQuery,
}: {
  collapsedQuery: ReturnType<typeof vi.fn>;
  organizationListQuery: ReturnType<typeof vi.fn>;
  projectListQuery: ReturnType<typeof vi.fn>;
}) {
  return (rows: MaybeStoredModelProvider[]) => {
    const collapsed = Object.fromEntries(rows.map((row) => [row.provider, row]));
    collapsedQuery.mockReturnValue(
      readyQueryResult({ providers: collapsed, modelMetadata: {} }),
    );
    const flat = readyQueryResult({ providers: rows, modelMetadata: {} });
    organizationListQuery.mockReturnValue(flat);
    projectListQuery.mockReturnValue(flat);
  };
}

/**
 * Credential inputs are labelled with a plain `Text` (no `htmlFor`/`id`),
 * so walk up from the label to the wrapper that owns exactly one input.
 */
export function fieldWrapper(labelText: string): HTMLElement {
  const label = screen.getByText(labelText);
  let node: HTMLElement | null = label;
  while (node && node.querySelectorAll("input").length !== 1) {
    node = node.parentElement;
  }
  if (!node) throw new Error(`no field found for label "${labelText}"`);
  return node;
}

export function inputFor(labelText: string): HTMLInputElement {
  return fieldWrapper(labelText).querySelector("input")!;
}

/**
 * Whether the field is marked required: the asterisk the customer sees
 * (`Field.RequiredIndicator`) and the `required` the field puts on its own
 * input. Both come from the same `Field.Root` prop, so a disagreement means
 * the affordance and the form semantics have come apart — worth failing on
 * rather than silently reading one of them.
 */
export function isMarkedRequired(labelText: string): boolean {
  const wrapper = fieldWrapper(labelText);
  const hasIndicator = !!wrapper.querySelector(".chakra-field__requiredIndicator");
  const inputIsRequired =
    wrapper.querySelector("input")?.hasAttribute("required") ?? false;
  if (hasIndicator !== inputIsRequired) {
    throw new Error(
      `"${labelText}": required marker (${hasIndicator}) disagrees with the input (${inputIsRequired})`,
    );
  }
  return hasIndicator;
}
