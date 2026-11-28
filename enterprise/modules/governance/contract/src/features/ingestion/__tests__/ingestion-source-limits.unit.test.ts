// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Spec: enterprise/modules/governance/specs/security-lake-ingest.feature */
import { describe, expect, it } from "vitest";

import {
  INGESTION_SOURCE_DESCRIPTION_MAX,
  INGESTION_SOURCE_NAME_MAX,
} from "../ingestion-source.commands.ts";
import {
  ingestionSourceCreateInputSchema,
  ingestionSourceUpdateInputSchema,
} from "../ingestion-sources.trpc.ts";

const created = { organizationId: "org_acme", sourceType: "otel_generic", name: "ACME" };
const edited = { organizationId: "org_acme", id: "src_1" };

describe("the ingestion source input limits", () => {
  it.each([
    ["create", ingestionSourceCreateInputSchema, created],
    ["update", ingestionSourceUpdateInputSchema, edited],
  ] as const)(
    "on %s takes a description at the limit and refuses one past it",
    (_, schema, base) => {
      const at = "d".repeat(INGESTION_SOURCE_DESCRIPTION_MAX);
      expect(schema.validate({ ...base, description: at })).toBe(true);
      expect(schema.validate({ ...base, description: `${at}d` })).toBe(false);
    },
  );

  it.each([
    ["create", ingestionSourceCreateInputSchema, created],
    ["update", ingestionSourceUpdateInputSchema, edited],
  ] as const)("on %s refuses a name past the limit", (_, schema, base) => {
    const name = "n".repeat(INGESTION_SOURCE_NAME_MAX + 1);
    expect(schema.validate({ ...base, name })).toBe(false);
  });
});
