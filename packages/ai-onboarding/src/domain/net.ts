/**
 * Grouping source addresses for the subnet axis.
 *
 * Rotating the last octet of a v4 address, or being handed a fresh v6 address
 * per connection, is the cheapest evasion of a per-IP limit there is. Both
 * collapse to one bucket here: /24 for v4, /64 for v6 — the smallest blocks
 * routinely assigned to a single subscriber.
 */

/** True for a dotted-quad. Anything else is treated as v6. */
function isIpv4(ip: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);
}

/**
 * A stable key for the address's subnet. Unparseable input returns the
 * address itself, which meters it as its own subnet — strictly tighter than
 * dropping it into a shared bucket with every other unparseable value.
 */
export function subnetKey(ip: string): string {
  const address = stripIpv4MappedPrefix(ip.trim().toLowerCase());
  if (address === "") return "unknown";

  if (isIpv4(address)) {
    const octets = address.split(".");
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }

  const groups = expandIpv6(address);
  if (groups === null) return address;
  return `${groups.slice(0, 4).join(":")}::/64`;
}

/** `::ffff:1.2.3.4` is a v4 address wearing a v6 hat — meter it as v4. */
function stripIpv4MappedPrefix(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  return mapped?.[1] ?? ip;
}

/**
 * Expand a v6 address to its eight groups. Returns null when the address
 * doesn't parse, so the caller can fall back rather than invent a bucket.
 */
function expandIpv6(address: string): string[] | null {
  const withoutZone = address.split("%")[0] ?? address;
  const halves = withoutZone.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(":") : [];
  if (halves.length === 1) return expandFullForm(head);

  const tail = halves[1] ? halves[1].split(":") : [];
  return expandCompressedForm(head, tail);
}

/** No `::` — all eight groups must already be there. */
function expandFullForm(groups: string[]): string[] | null {
  if (groups.length !== 8 || !groups.every(isHextet)) return null;
  return groups.map(pad);
}

/** `::` stands for at least one all-zero group. */
function expandCompressedForm(head: string[], tail: string[]): string[] | null {
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  if (![...head, ...tail].every(isHextet)) return null;

  return [
    ...head.map(pad),
    ...Array<string>(fill).fill("0000"),
    ...tail.map(pad),
  ];
}

function isHextet(group: string): boolean {
  return /^[0-9a-f]{1,4}$/.test(group);
}

function pad(group: string): string {
  return group.padStart(4, "0");
}
