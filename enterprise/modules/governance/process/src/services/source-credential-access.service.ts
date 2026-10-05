// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { IngestionSourceNotFoundError } from "@langwatch/enterprise-governance-contract";

import type { IngestionSourceRepository } from "../repositories/ingestion-source.repository.ts";
import { credentialsOf } from "../rules/ingestion-credentials.rules.ts";

/** Everything about the source; `credentials` is the opened bag, for the call only. */
export interface SourceCredentialContext {
  sourceId: string;
  sourceType: string;
  /** `parserConfig` with the `credentials` key removed, so spreading it cannot leak the secret. */
  config: Record<string, unknown>;
  credentials: Record<string, string>;
}

/**
 * Calls a provider for one source outside the scheduled pull. A callback, not a getter: the caller
 * gets the result of the work and the secret has no name outside this frame. Source status is not
 * checked; a person pressing a button has asked, where the scheduler skips a disabled source.
 */
export class SourceCredentialAccessService {
  private constructor(private readonly deps: { sources: IngestionSourceRepository }) {}

  static create(deps: { sources: IngestionSourceRepository }): SourceCredentialAccessService {
    return new SourceCredentialAccessService(deps);
  }

  /** Another organization's source is a miss, refused before its credentials reach anyone. */
  async withSourceCredentials<T>({
    organizationId,
    ingestionSourceId,
    use,
  }: {
    organizationId: string;
    ingestionSourceId: string;
    use: (context: SourceCredentialContext) => Promise<T>;
  }): Promise<T> {
    const source = await this.deps.sources.findById(ingestionSourceId);
    if (!source || source.organizationId !== organizationId) {
      throw new IngestionSourceNotFoundError(ingestionSourceId);
    }

    const { credentials, ...config } = source.parserConfig;
    return use({
      sourceId: source.id,
      sourceType: source.sourceType,
      config,
      credentials: credentialsOf(credentials),
    });
  }
}
