/** Spec: specs/observability/request-log-client-and-principal.feature */
import type { OtlpIngestCredential } from "@langwatch/otlp/door";
import { describe, expect, it, vi } from "vitest";

import { otlpMetricsDoor } from "../otlp-metrics.rest.ts";

// The door never traces; the receiver's tracer is not needed to identify a bearer.
vi.mock("langwatch", () => ({ getLangWatchTracer: () => ({}) }));

const PROJECT = { id: "project_1", teamId: "team_1", organizationId: "organization_1" };

function identifiedWith(identity: Partial<OtlpIngestCredential["identity"]>) {
  const credential: OtlpIngestCredential = {
    project: PROJECT,
    identity: {
      apiKeyId: null,
      organizationId: PROJECT.organizationId,
      ingestSourceType: null,
      ingestionTemplateId: null,
      ...identity,
    },
  };
  const traces = { otlpCredential: async () => credential } as unknown as Parameters<
    typeof otlpMetricsDoor.open
  >[0];
  const request = new Request("http://localhost/api/otel/v1/metrics", {
    method: "POST",
    headers: { authorization: "Bearer sk-lw-test" },
  });

  return otlpMetricsDoor.open(traces).identify({ request });
}

describe("the OTLP metrics door", () => {
  /** @scenario "The request log names the key behind OTLP ingestion" */
  it("names an ingestion key by its id and kind", async () => {
    const caller = await identifiedWith({
      apiKeyId: "key_ingest",
      ingestSourceType: "openai",
      ingestionTemplateId: "tpl_1",
    });

    expect(caller.key).toEqual({
      kind: "ingestion_key",
      apiKeyId: "key_ingest",
      ownerUserId: null,
    });
  });

  it("names an ingestion key that has no template as an ingestion key", async () => {
    const caller = await identifiedWith({ apiKeyId: "key_ingest", ingestSourceType: "openai" });

    expect(caller.key).toEqual({
      kind: "ingestion_key",
      apiKeyId: "key_ingest",
      ownerUserId: null,
    });
  });

  it("names a project API key by its id and kind", async () => {
    const caller = await identifiedWith({ apiKeyId: "key_project" });

    expect(caller.key).toEqual({ kind: "api_key", apiKeyId: "key_project", ownerUserId: null });
  });

  it("names the legacy project key by its kind alone", async () => {
    const caller = await identifiedWith({});

    expect(caller.key).toEqual({ kind: "legacy_project_key", apiKeyId: null, ownerUserId: null });
  });
});
