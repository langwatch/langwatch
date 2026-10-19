/**
 * @vitest-environment node
 * Sensitive management writes carry a declared audit action; reads and ingest carry none.
 */
import { describe, expect, it } from "vitest";

import { apiKeyOrganizationsRest } from "../api-key-organizations.rest.ts";
import { apiKeyProjectsRest } from "../api-key-projects.rest.ts";
import { apiKeyRest } from "../api-key.rest.ts";

describe("the management REST audit declaration", () => {
  it("api-key.rest audits its sensitive writes under their management action", () => {
    const audited = apiKeyRest.router().routes.filter((route) => route.audit !== undefined);

    expect(audited.map((route) => [route.operation, route.audit])).toEqual(
      expect.arrayContaining([
        ["createApiKey", "management.api-key.create"],
        ["updateApiKey", "management.api-key.update"],
        ["revokeApiKey", "management.api-key.revoke"],
        ["createIngestionApiKey", "management.api-key.create-ingestion"],
        ["createFullAccessApiKey", "management.api-key.create-full-access"],
      ]),
    );
  });

  it("api-key-projects.rest audits its sensitive writes under their management action", () => {
    const audited = apiKeyProjectsRest.router().routes.filter((route) => route.audit !== undefined);

    expect(audited.map((route) => [route.operation, route.audit])).toEqual(
      expect.arrayContaining([["createProject", "management.project.create"]]),
    );
  });

  it("api-key-organizations.rest audits its sensitive writes under their management action", () => {
    const audited = apiKeyOrganizationsRest
      .router()
      .routes.filter((route) => route.audit !== undefined);

    expect(audited.map((route) => [route.operation, route.audit])).toEqual(
      expect.arrayContaining([["provisionOrganization", "management.organization.provision"]]),
    );
  });
});
