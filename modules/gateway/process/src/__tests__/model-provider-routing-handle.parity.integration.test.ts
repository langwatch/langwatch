import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RESERVED_ROUTING_HANDLES } from "@langwatch/model-provider-contract";

function gatewayProviderFamilies(): string[] {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
  const source = readFileSync(
    resolve(repositoryRoot, "services/aigateway/domain/provider.go"),
    "utf8",
  );
  const block = /var knownProviderFamilies = map\[string\]struct\{\}\{\n([\s\S]*?)\n\}/.exec(
    source,
  )?.[1];
  if (!block) {
    throw new Error("knownProviderFamilies not found in services/aigateway/domain/provider.go");
  }

  return [...block.matchAll(/"([^"]+)":/g)].map((match) => match[1]!);
}

describe("gateway model provider families", () => {
  it("reserves every provider family before handles can shadow it", () => {
    const families = gatewayProviderFamilies();
    expect(families.length).toBeGreaterThan(10);
    expect(families.filter((family) => !RESERVED_ROUTING_HANDLES.has(family))).toEqual([]);
  });
});
