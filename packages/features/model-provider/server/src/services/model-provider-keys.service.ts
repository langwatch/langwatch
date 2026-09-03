import {
  MASKED_KEY_PLACEHOLDER,
  ModelProviderCredentialsUnreadableError,
  ModelProviderCredentialsWouldBeDroppedError,
  isSecretCredentialField,
  modelProviders,
  type ModelProviderDefinition,
} from "@langwatch/model-provider-contract";
import { z } from "zod";
import { ModelProviderCredentialPolicy } from "../ports/model-provider.port";

type Header = { key: string; value: string };

export class ModelProviderKeysService extends ModelProviderCredentialPolicy {
  private constructor() {
    super();
  }

  static create(): ModelProviderKeysService {
    return new ModelProviderKeysService();
  }

  tryNormalize(
    provider: string,
    value: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (value === null) {
      return null;
    }

    const definition = providerDefinition(provider);
    return z
      .union([definition.keysSchema, z.object({ MANAGED: z.string() })])
      .pipe(z.record(z.string(), z.unknown()))
      .parse(value);
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

    const preserved = Object.entries(input.stored).filter(([key, value]) => {
      if (input.incoming && key in input.incoming) {
        return input.incoming[key] === MASKED_KEY_PLACEHOLDER;
      }

      return isSecretCredentialField(key) && value !== "" && value != null;
    });

    return { ...edited, ...Object.fromEntries(preserved) };
  }

  tryMask(value: Record<string, unknown> | null): Record<string, unknown> | null {
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

  mergeHeaders(input: { incoming: Header[]; stored: Header[] }): Header[] {
    const incomingKeys = new Set(input.incoming.map(({ key }) => key));

    return input.incoming.flatMap((header, index) => {
      if (header.value !== MASKED_KEY_PLACEHOLDER) {
        return [header];
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
  }

  maskHeaders(value: Header[]): Header[] {
    return value.map(({ key }) => ({ key, value: MASKED_KEY_PLACEHOLDER }));
  }
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
