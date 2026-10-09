import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import { parseGenerateLicenseArgs } from "../rules/generate-license-args.rules.ts";
import type { LicenseMintService } from "../services/license-mint.service.ts";

const logger = createLogger("langwatch:licensing:generate-license");

type GenerateLicensePeers = Readonly<{
  mint: Pick<LicenseMintService, "applyToOrganization">;
}>;

/**
 * Main's `scripts/generate-license.ts`, same flags: mints a license onto an existing
 * organization and records it in the registry (license-registry.feature).
 */
export class GenerateLicenseTask extends Task {
  readonly name = "generate-license";
  readonly description = "Mints a license onto an organization and records it in the registry.";

  private constructor(private readonly peers: GenerateLicensePeers) {
    super();
  }

  static create(peers: GenerateLicensePeers): GenerateLicenseTask {
    return new GenerateLicenseTask(peers);
  }

  async run({ args, signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const request = parseGenerateLicenseArgs(args);
    signal.throwIfAborted();
    const result = await this.peers.mint.applyToOrganization(request);
    logger.info(result, "license minted onto the organization");
  }
}
