import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/**
 * Where a domain proof's TXT lookup asks, in node's `setServers` spelling
 * (`127.0.0.1:15353`, comma-separated). A deployment names none and the
 * machine's own resolver answers; development names the simulator.
 */
const nameserversSchema = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ""),
  );

export const identityConfig = Config.define((c) => ({
  ssoDomainProofDnsServers: c.env("SSO_DOMAIN_PROOF_DNS_SERVERS", nameserversSchema),
}));

export type IdentityServerConfig = ConfigOf<typeof identityConfig>;
