import { DnsSsoDomainProofChannel } from "./dns.sso-domain-proof.channel.ts";
import { HttpsSsoDomainProofFileChannel } from "./http/http.sso-domain-proof-file.channel.ts";
import { MemorySsoDomainProofFileChannel } from "./memory/memory.sso-domain-proof-file.channel.ts";
import { MemorySsoDomainProofChannel } from "./memory/memory.sso-domain-proof.channel.ts";

/** The record a customer publishes, read over DNS. */
export const ssoDomainProofChannels = {
  live: DnsSsoDomainProofChannel,
  memory: MemorySsoDomainProofChannel,
};

/** The same proof, read out of the file the domain serves. */
export const ssoDomainProofFileChannels = {
  live: HttpsSsoDomainProofFileChannel,
  memory: MemorySsoDomainProofFileChannel,
};
