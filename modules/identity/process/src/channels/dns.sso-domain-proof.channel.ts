import { Resolver } from "node:dns/promises";

import { createLogger } from "@langwatch/observability";

import { classifyDnsLookupFailure } from "../rules/domain-proof-lookup.rules.ts";
import type { SsoDomainProofChannel, SsoDomainTxtLookup } from "./sso-domain-proof.channel.ts";

const logger = createLogger("langwatch:identity:sso-domain-proof");

/**
 * The one thing this channel needs of DNS, so a test never touches it. A
 * record is a list of character-strings, which is why node answers an array
 * of arrays and a stub implements exactly that.
 */
export interface TxtRecordResolver {
  resolveTxt(name: string): Promise<string[][]>;
}

/**
 * Bounded because this runs inside a request an administrator is watching:
 * node's five seconds over four tries would hold the page for twenty.
 */
const LOOKUP_TIMEOUT_MS = 3_000;
const LOOKUP_TRIES = 2;

/**
 * Reading the record a customer published, over real DNS. No cache of our
 * own: the resolver's is the one that matters, and a second here would call a
 * freshly-published record missing for minutes after it went live.
 */
export class DnsSsoDomainProofChannel implements SsoDomainProofChannel {
  private constructor(private readonly resolver: TxtRecordResolver) {}

  /**
   * `nameservers` is node's `setServers` shape (`127.0.0.1:15353`): how local
   * development proves a reserved name. Whoever supplies it decides where
   * that is allowed; a deployment supplies nothing.
   */
  static create(
    options: { resolver?: TxtRecordResolver; nameservers?: readonly string[] } = {},
  ): DnsSsoDomainProofChannel {
    if (options.resolver) return new DnsSsoDomainProofChannel(options.resolver);

    const resolver = new Resolver({ timeout: LOOKUP_TIMEOUT_MS, tries: LOOKUP_TRIES });
    const servers = (options.nameservers ?? []).filter((entry) => entry !== "");
    if (servers.length === 0) return new DnsSsoDomainProofChannel(resolver);

    try {
      resolver.setServers([...servers]);
      logger.info({ servers }, "single sign-on domain proofs resolve against a named nameserver");
    } catch (error) {
      // A malformed value must not take domain proof down with it: the
      // machine's own resolver is a working answer, and the misconfiguration
      // is worth a line rather than a dead ceremony.
      logger.warn({ servers, error }, "the named nameservers could not be applied");
    }

    return new DnsSsoDomainProofChannel(resolver);
  }

  async lookupTxtValues({ name }: { domain: string; name: string }): Promise<SsoDomainTxtLookup> {
    try {
      // A value longer than 255 characters arrives split, and joining is how
      // it becomes the string the customer pasted in.
      const values = (await this.resolver.resolveTxt(name)).map((chunks) => chunks.join(""));
      if (values.length === 0) return { outcome: "absent" };

      return { outcome: "published", values };
    } catch (error) {
      const failure = classifyDnsLookupFailure(error);
      if (failure.outcome === "absent") {
        logger.info({ name }, "no verification record is published");

        return failure;
      }
      // A warning and not an error: a real failure, and also a nameserver
      // having a bad minute — neither ours to page on nor the customer's to
      // be blamed for.
      logger.warn(
        { name, reason: failure.reason, error },
        "the verification record could not be looked up",
      );

      return failure;
    }
  }
}
