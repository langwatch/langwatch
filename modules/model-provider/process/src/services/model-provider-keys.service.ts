import {
  MASKED_KEY_PLACEHOLDER,
  ModelProviderCredentialsUnreadableError,
  ModelProviderCredentialsWouldBeDroppedError,
  isSecretCredentialField,
  modelProviders,
  type ModelProviderDefinition,
} from "@langwatch/model-provider-contract";
import { z } from "zod";

/**
 * Provider-specific credential rules. Encryption belongs to the codec above;
 * this policy validates writes, preserves masked values, and redacts reads.
 */
export abstract class ModelProviderCredentialPolicy {
  abstract normalizeKeys(
    provider: string,
    value: Record<string, unknown> | null,
  ): Record<string, unknown> | null;
  abstract merge(input: {
    incoming: Record<string, unknown> | null;
    stored: Record<string, unknown> | null;
  }): Record<string, unknown>;
  abstract toMaskedKeys(value: Record<string, unknown> | null): Record<string, unknown> | null;
  abstract hasUsableReplacement(value: Record<string, unknown> | null): boolean;
  abstract assertCredentialsCanBeSaved(input: {
    provider: string;
    incoming: Record<string, unknown> | null;
    stored: Record<string, unknown> | null;
    storedCredentialsUnreadable: boolean;
  }): void;
  /** Whether a credential write names an endpoint other than the stored one. */
  abstract endpointMoved(input: {
    incoming: Record<string, unknown> | null;
    stored: Record<string, unknown> | null;
  }): boolean;
  /** A masked header value is restored only while the endpoint stays where it was. */
  abstract mergeHeaders(input: {
    incoming: { key: string; value: string }[];
    stored: { key: string; value: string }[];
    endpointMoved: boolean;
  }): { key: string; value: string }[];
  abstract maskHeaders(value: { key: string; value: string }[]): { key: string; value: string }[];
}

type Header = { key: string; value: string };

type CredentialWrite = {
  incoming: Record<string, unknown> | null;
  stored: Record<string, unknown> | null;
};

const isEndpointField = (key: string): boolean => /_(BASE_URL|ENDPOINT)$/.test(key);

/** A write names an endpoint other than the stored one; an echoed mask names none. */
function endpointMoved({ incoming, stored }: CredentialWrite): boolean {
  return Object.entries(incoming ?? {}).some(
    ([key, value]) =>
      isEndpointField(key) &&
      value !== MASKED_KEY_PLACEHOLDER &&
      (value ?? "") !== (stored?.[key] ?? ""),
  );
}

const managedKeysSchema = z.object({ MANAGED: z.string() });
const normalizedKeysSchema = z.record(z.string(), z.unknown());

export class ModelProviderKeysService extends ModelProviderCredentialPolicy {
  private constructor() {
    super();
  }

  static create(): ModelProviderKeysService {
    return new ModelProviderKeysService();
  }

  normalizeKeys(
    provider: string,
    value: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (value === null) {
      return null;
    }

    return getKeysNormalizer(provider).parse(value);
  }

  merge(input: {
    incoming: Record<string, unknown> | null;
    stored: Record<string, unknown> | null;
  }): Record<string, unknown> {
    const edited = Object.fromEntries(
      Object.entries(input.incoming ?? {}).filter(([, value]) => value !== MASKED_KEY_PLACEHOLDER),
    );
    if (!input.stored) {
      return edited;
    }

    // A stored secret is only ever sent to the endpoint it was saved with.
    const stored = input.stored;
    const moved = endpointMoved({ incoming: input.incoming, stored });

    const preserved = Object.entries(stored).filter(([key, value]) => {
      if (moved && isSecretCredentialField(key)) {
        return false;
      }
      if (input.incoming && key in input.incoming) {
        return input.incoming[key] === MASKED_KEY_PLACEHOLDER;
      }

      return isSecretCredentialField(key) && value !== "" && value != null;
    });

    return { ...edited, ...Object.fromEntries(preserved) };
  }

  toMaskedKeys(value: Record<string, unknown> | null): Record<string, unknown> | null {
    if (value === null) {
      return null;
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [
        key,
        isSecretCredentialField(key) ? MASKED_KEY_PLACEHOLDER : field,
      ]),
    );
  }

  hasUsableReplacement(value: Record<string, unknown> | null): boolean {
    return Object.values(value ?? {}).some(
      (field) => typeof field === "string" && field.length > 0 && field !== MASKED_KEY_PLACEHOLDER,
    );
  }

  assertCredentialsCanBeSaved(input: {
    provider: string;
    incoming: Record<string, unknown> | null;
    stored: Record<string, unknown> | null;
    storedCredentialsUnreadable: boolean;
  }): void {
    if (input.storedCredentialsUnreadable) {
      if (!this.hasUsableReplacement(input.incoming)) {
        throw new ModelProviderCredentialsUnreadableError(input.provider);
      }

      return;
    }

    if (!input.stored) {
      return;
    }

    const keys = credentialKeys(providerDefinition(input.provider));
    if (keys.size === 1) {
      return;
    }

    const incomingCredentials = Object.keys(input.incoming ?? {}).filter((key) => keys.has(key));
    if (incomingCredentials.length > 0) {
      return;
    }

    const hasStoredCredential = Object.entries(input.stored).some(
      ([key, value]) => keys.has(key) && typeof value === "string" && value.length > 0,
    );
    if (hasStoredCredential) {
      throw new ModelProviderCredentialsWouldBeDroppedError(input.provider);
    }
  }

  endpointMoved(input: CredentialWrite): boolean {
    return endpointMoved(input);
  }

  mergeHeaders(input: { incoming: Header[]; stored: Header[]; endpointMoved: boolean }): Header[] {
    const incomingKeys = new Set(input.incoming.map(({ key }) => key));

    const merged = input.incoming.flatMap((header, index) => {
      if (header.value !== MASKED_KEY_PLACEHOLDER) {
        return [header];
      }
      // Header values are masked like secrets, so they stay with the endpoint too.
      if (input.endpointMoved) {
        return [];
      }

      const storedByKey = input.stored.find(({ key }) => key === header.key);
      if (storedByKey) {
        return [{ key: header.key, value: storedByKey.value }];
      }

      const storedAtPosition = input.stored[index];
      const positionIsAvailable =
        storedAtPosition !== void 0 && !incomingKeys.has(storedAtPosition.key);

      return positionIsAvailable ? [{ key: header.key, value: storedAtPosition.value }] : [];
    });

    // A header is spent as an HTTP header and nowhere else, and http.client
    // refuses a name or value whose edges carry whitespace — with no
    // query-string variant to launder it the way an API key has.
    return trimHeaders(merged);
  }

  maskHeaders(value: Header[]): Header[] {
    return value.map(({ key }) => ({ key, value: MASKED_KEY_PLACEHOLDER }));
  }
}

/**
 * Strip the whitespace around every header name and value. Whitespace inside
 * a value is left alone — "Bearer abc" is legitimate, " Bearer abc" is a
 * value http.client refuses to send at all.
 */
function trimHeaders(headers: Header[]): Header[] {
  return headers.map(({ key, value }) => ({ key: key.trim(), value: value.trim() }));
}

const providerRegistry: Record<string, ModelProviderDefinition> = modelProviders;
const keysNormalizers = new Map(
  Object.entries(providerRegistry).map(([provider, definition]) => [
    provider,
    z.union([definition.keysSchema, managedKeysSchema]).pipe(normalizedKeysSchema),
  ]),
);

function getKeysNormalizer(provider: string) {
  const normalizer = keysNormalizers.get(provider);
  if (!normalizer) {
    throw new Error(`Unknown model provider: ${provider}`);
  }

  return normalizer;
}

function providerDefinition(provider: string): ModelProviderDefinition {
  const registry: Record<string, ModelProviderDefinition> = modelProviders;
  const definition = registry[provider];
  if (!definition) {
    throw new Error(`Unknown model provider: ${provider}`);
  }

  return definition;
}

function credentialKeys(definition: ModelProviderDefinition): Set<string> {
  const schema = z.toJSONSchema(definition.keysSchema);

  return new Set([...Object.keys(schema.properties ?? {}), "MANAGED"]);
}
