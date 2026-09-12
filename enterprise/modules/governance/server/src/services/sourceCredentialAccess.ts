// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Calling a provider for one source, outside the scheduled pull.
 *
 * Until this module the ONLY path that unsealed a source's credentials was
 * `runIngestionPull`, reached from the outbox. That is a good property and this
 * does not spend it: the seam is one function, it reuses `decryptCredentials`
 * rather than reaching into the envelope itself, and the plaintext exists only
 * for the duration of the callback.
 *
 * A CALLBACK rather than a getter, and that is the point of the shape. A
 * function that returned credentials would put them in a variable somebody can
 * hold, log, widen a return type with, or accidentally include in a DTO. Here
 * there is nothing to return them into: the caller gets the RESULT of the work,
 * and the secret has no name outside this file's stack frame.
 *
 * The sealed envelope never travels either. `use` is handed the source's config
 * with `credentials` stripped, so a caller that spreads the config into a
 * response cannot leak the envelope — which matters because re-encryption is
 * idempotent by design, and an envelope handed back on a write path is a secret
 * somebody kept without ever proving they knew it (`isEncryptedCredentials`).
 */

import { IngestionSourceNotFoundError } from "@langwatch/enterprise-governance-contract";
import type { PrismaClient } from "~/generated/prisma/client";
import { decryptCredentials } from "../activity-monitor/ingestionCredentials";

/** What the callback is given: everything about the source EXCEPT the seal. */
export interface SourceCredentialContext {
  sourceId: string;
  sourceType: string;
  /** `parserConfig` with the `credentials` key removed. */
  config: Record<string, unknown>;
  /** Plaintext, valid only for the duration of the call. Never log a value. */
  credentials: Record<string, string>;
}

/**
 * Runs `use` with one source's unsealed credentials.
 *
 * Scoped by organization in the predicate rather than checked after the read,
 * so a caller cannot name another tenant's source and have its credentials
 * decrypted before the check fails. A miss is
 * {@link IngestionSourceNotFoundError} — a known cause with an obvious action,
 * which is exactly what the mutations that name a source already raise.
 *
 * Source STATUS is not checked here, deliberately. The scheduled loop skips a
 * disabled source so an unattended cron stops spending requests on one nobody
 * asked to run; a person pressing a button on a screen has asked, and refusing
 * them because a switch is off would be answering a question they did not put.
 * A caller that wants the scheduler's rule applies it itself.
 */
export async function withSourceCredentials<T>(params: {
  prisma: PrismaClient;
  organizationId: string;
  ingestionSourceId: string;
  use: (context: SourceCredentialContext) => Promise<T>;
}): Promise<T> {
  const { prisma, organizationId, ingestionSourceId, use } = params;

  const source = await prisma.ingestionSource.findFirst({
    where: { id: ingestionSourceId, organizationId },
    select: { id: true, sourceType: true, parserConfig: true },
  });
  if (!source) throw new IngestionSourceNotFoundError(ingestionSourceId);

  const parserConfig = (source.parserConfig ?? {}) as Record<string, unknown>;
  const { credentials: sealed, ...config } = parserConfig;

  return await use({
    sourceId: source.id,
    sourceType: source.sourceType,
    config,
    credentials: decryptCredentials(sealed),
  });
}
