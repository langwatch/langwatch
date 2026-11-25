import { lookup } from "node:dns/promises";

/** Every address one host name resolves to. A name that resolves to nothing
 *  answers the empty list rather than throwing. */
export type HostAddressResolver = (host: string) => Promise<string[]>;

/** The system resolver, every family, the way an outbound dial would see it. */
export const systemHostAddresses: HostAddressResolver = async (host) => {
  const found = await lookup(host, { all: true }).catch(() => []);
  return found.map((entry) => entry.address);
};
