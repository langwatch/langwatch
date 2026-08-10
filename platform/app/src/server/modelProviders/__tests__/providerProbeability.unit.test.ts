import { describe, expect, it, vi } from "vitest";

// Same stand-in the sibling validation tests use: the probe goes out through
// the SSRF-validated fetch rather than `global.fetch`, so replacing the global
// would leave the real validator in the path and every assertion below would
// be about DNS instead of about the decision under test.
const mockFetch = vi.fn();
vi.mock("../../../utils/ssrfProtection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/ssrfProtection")>()),
  ssrfSafeFetch: (...args: unknown[]) => mockFetch(...args),
}));

import { validateProviderApiKey } from "../providerValidation";
import {
  isProviderProbeable,
  modelProviders,
  UNPROBEABLE_PROVIDERS,
} from "../registry";

/**
 * A credential that satisfies a provider's schema, built from the schema
 * itself.
 *
 * Hand-written fixtures per provider would have to be revisited every time the
 * registry gains one, and the test whose whole job is catching a registry
 * change is the worst possible place for that. Endpoint-shaped fields get a
 * URL because several schemas call `.url()`; everything else gets a token.
 */
function completeCredentialFor(providerKey: string): Record<string, string> {
  const definition = modelProviders[providerKey as keyof typeof modelProviders];
  const shape =
    (definition.keysSchema as unknown as {
      shape?: Record<string, unknown>;
      _def?: { schema?: { shape?: Record<string, unknown> } };
    }) ?? {};
  // `gemini` wraps its object in a `superRefine`, which moves the shape one
  // level down. Reading both keeps this working either side of that.
  const fields = shape.shape ?? shape._def?.schema?.shape ?? {};

  return Object.fromEntries(
    Object.keys(fields).map((field) => [
      field,
      /ENDPOINT|BASE_URL|_URL/.test(field)
        ? "https://provider.example.test/v1"
        : "a-credential-value",
    ]),
  );
}

describe("isProviderProbeable", () => {
  describe("given every provider in the registry", () => {
    /** @scenario A provider that cannot be checked offers no control */
    it("names exactly the providers a probe would refuse to check", () => {
      const refused = Object.keys(modelProviders).filter(
        (providerKey) => !isProviderProbeable({ provider: providerKey }),
      );

      expect(new Set(refused)).toEqual(new Set(UNPROBEABLE_PROVIDERS));
    });

    /**
     * The pin that matters. Comparing the predicate against a second copy of
     * the same list would only prove the two constants match; this asks the
     * validator itself, with a credential it should be happy with, and
     * requires the answers to agree. A provider added to the registry, or an
     * endpoint added to one that had none, fails here rather than shipping a
     * control that offers a check nothing can perform.
     *
     * @scenario Both places agree on which providers can be checked
     */
    it.each(
      Object.keys(modelProviders),
    )("agrees with what validation actually does for %s", async (providerKey) => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
        text: async () => "{}",
      });

      const result = await validateProviderApiKey(
        providerKey,
        completeCredentialFor(providerKey),
      );

      const wouldBeChecked = result.outcome !== "unchecked";
      expect(wouldBeChecked).toBe(
        isProviderProbeable({ provider: providerKey }),
      );
    });
  });

  describe("when the provider is not one we recognize", () => {
    it("reports it as unprobeable rather than throwing", () => {
      expect(isProviderProbeable({ provider: "not_a_provider" })).toBe(false);
    });
  });
});
