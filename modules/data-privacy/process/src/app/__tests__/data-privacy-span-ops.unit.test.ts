import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import { DataPrivacyApi, PRIVACY_DROPPED_MARKER_ATTR } from "@langwatch/data-privacy-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApp } from "@langwatch/kernel";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  createDataPrivacyTestProjects,
  dataPrivacyTestGraph,
  dataPrivacyTestInfrastructure,
  installableDataPrivacy,
} from "./data-privacy.fixture.ts";

const PROJECT_ID = dataPrivacyTestGraph.projectId;

function spanWith(value: string): OtlpSpan {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    name: "llm",
    kind: 1,
    startTimeUnixNano: "1",
    endTimeUnixNano: "2",
    attributes: [{ key: "langwatch.input", value: { stringValue: value } }],
    events: [],
    links: [],
    status: {},
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

async function boot({ enforcement }: { enforcement?: string }) {
  const runtime = await createApp({ role: "worker" })
    .withModules([installableDataPrivacy()])
    .withMember("dataPrivacy", dataPrivacyTestInfrastructure())
    .withMember("nodeEnvironment", undefined)
    .withConfig({ "data-privacy": { googleDlpDisabled: undefined, enforcement } })
    .provide({
      project: createDataPrivacyTestProjects(),
      organization: createApiFixture<OrganizationApi>(),
      authz: createApiFixture<AuthzApi>(),
      "feature-flag": createApiFixture<FeatureFlagApi>({ isEnabled: async () => false }),
      evaluation: createApiFixture<EvaluationApi>(),
    })
    .boot();

  return { app: runtime.service(DataPrivacyApi), stop: () => runtime.stop() };
}

async function dropInputForProject(app: DataPrivacyApi): Promise<void> {
  await app.setForScope({
    organizationId: dataPrivacyTestGraph.organizationId,
    scope: { scopeType: "PROJECT", scopeId: PROJECT_ID },
    personalOnly: false,
    config: { categories: { input: { disposition: "drop" } } },
  });
}

describe("given a peer handing a span to the data-privacy API", () => {
  describe("when the project's policy drops input content", () => {
    /** @scenario "A peer drops a span's content through the data-privacy API" */
    it("strips the content and stamps the dropped-category marker", async () => {
      const { app, stop } = await boot({});
      try {
        await dropInputForProject(app);
        const span = spanWith("my question");

        const result = await app.dropSpanContent({ span, projectId: PROJECT_ID });

        expect(result.droppedCategories).toEqual(["input"]);
        expect(span.attributes.map((attr) => attr.key)).toContain(PRIVACY_DROPPED_MARKER_ATTR);
      } finally {
        await stop();
      }
    });

    /** @scenario "The enforcement switch set to off leaves a peer's span whole" */
    it("keeps the span whole when the deployment turned enforcement off", async () => {
      const { app, stop } = await boot({ enforcement: "off" });
      try {
        await dropInputForProject(app);
        const span = spanWith("my question");

        const result = await app.dropSpanContent({ span, projectId: PROJECT_ID });

        expect(result).toEqual({
          droppedCount: 0,
          droppedCategories: [],
          droppedAttributeKeys: [],
        });
        expect(span).toEqual(spanWith("my question"));
      } finally {
        await stop();
      }
    });
  });

  describe("when the span carries an email address", () => {
    /** @scenario "A peer redacts a span through the data-privacy API" */
    it("redacts the address in place", async () => {
      const { app, stop } = await boot({});
      try {
        const span = spanWith("write to jane.doe@example.com today");

        await app.redactSpan({
          span,
          resource: null,
          piiRedactionLevel: "ESSENTIAL",
          tenantId: PROJECT_ID,
        });

        expect(span.attributes[0]?.value.stringValue).not.toContain("jane.doe@example.com");
      } finally {
        await stop();
      }
    });
  });
});
