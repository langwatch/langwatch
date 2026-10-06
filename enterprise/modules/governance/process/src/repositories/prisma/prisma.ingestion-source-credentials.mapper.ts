// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import type { Encryption } from "@langwatch/process-stores";

import {
  isSealedCredentials,
  SEALED_CREDENTIALS_PREFIX,
} from "../../rules/ingestion-credentials.rules.ts";

const logger = createLogger("langwatch:governance:ingestion-credentials");

/**
 * The stored form of a source's `parserConfig.credentials`: the prefix, then the process cipher
 * over the JSON, exactly as main sealed it, so rows written by either side open on the other.
 */
export class PrismaIngestionSourceCredentialsMapper {
  static create({ cipher }: { cipher: Encryption }): PrismaIngestionSourceCredentialsMapper {
    return new PrismaIngestionSourceCredentialsMapper(cipher);
  }

  private constructor(private readonly cipher: Encryption) {}

  /** Seals credentials given in the clear; a value already in its stored form is kept as it is. */
  seal(parserConfig: Record<string, unknown>): Record<string, unknown> {
    const credentials = parserConfig.credentials;
    if (credentials === undefined || credentials === null || isSealedCredentials(credentials)) {
      return parserConfig;
    }

    return {
      ...parserConfig,
      credentials: SEALED_CREDENTIALS_PREFIX + this.cipher.encrypt(JSON.stringify(credentials)),
    };
  }

  /**
   * Opens sealed credentials into their bag. One that will not open keeps its stored form, so a
   * listing still answers and an edit writes the same secret back instead of erasing it.
   */
  open(parserConfig: Record<string, unknown>): Record<string, unknown> {
    const sealed = parserConfig.credentials;
    if (!isSealedCredentials(sealed)) return parserConfig;

    let parsed: unknown;
    try {
      parsed = JSON.parse(this.cipher.decrypt(sealed.slice(SEALED_CREDENTIALS_PREFIX.length)));
    } catch (error) {
      // The error NAME only: a refusal may quote its input, and the input here is a secret.
      logger.warn(
        {
          errorName: error instanceof Error ? error.name : "unknown",
          encryptedLength: sealed.length,
        },
        "an ingestion source's credentials would not open; keeping their stored form",
      );
      return parserConfig;
    }

    return { ...parserConfig, credentials: parsed && typeof parsed === "object" ? parsed : {} };
  }
}
