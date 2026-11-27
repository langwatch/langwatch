/**
 * Regenerates `disposable-email-domains.generated.json`, the checked-in copy of the community list
 * of disposable email domains (CC0) the sign-up policy refuses. Run it to pick up new domains.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE_URL =
  "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf";

const OUTPUT_PATH = fileURLToPath(
  new URL("../src/rules/disposable-email-domains.generated.json", import.meta.url),
);

/** A refresh that shrinks the list this far is more likely a broken download than a cleanup. */
const MINIMUM_DOMAINS = 5_000;

const DOMAIN_SHAPE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

async function main(): Promise<void> {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`Fetching ${SOURCE_URL} answered ${response.status}`);

  const domains = [
    ...new Set(
      (await response.text())
        .split("\n")
        .map((line) => line.trim().toLowerCase())
        .filter((line) => line.length > 0 && !line.startsWith("#")),
    ),
  ].toSorted();

  const malformed = domains.filter((domain) => !DOMAIN_SHAPE.test(domain));
  if (malformed.length > 0) throw new Error(`Malformed domains: ${malformed.join(", ")}`);
  if (domains.length < MINIMUM_DOMAINS) {
    throw new Error(`Only ${domains.length} domains downloaded; refusing to write the list`);
  }

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(domains, null, 2)}\n`);
  process.stdout.write(`Wrote ${domains.length} domains to ${OUTPUT_PATH}\n`);
}

await main();
