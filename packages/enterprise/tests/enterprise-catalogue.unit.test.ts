import { describe, expect, it } from "vitest";
import { EnterpriseCatalogue } from "../src";

describe("EnterpriseCatalogue", () => {
  it("discovers every installed Enterprise feature through portable package names", () => {
    expect(EnterpriseCatalogue.create().list()).toEqual([
      {
        id: "licensing",
        contractPackage: "@langwatch/enterprise-licensing-contract",
        serverPackage: "@langwatch/enterprise-licensing-server",
      },
      {
        id: "sso",
        contractPackage: "@langwatch/enterprise-sso-contract",
        serverPackage: "@langwatch/enterprise-sso-server",
      },
      {
        id: "scim",
        contractPackage: "@langwatch/enterprise-scim-contract",
        serverPackage: "@langwatch/enterprise-scim-server",
      },
      {
        id: "audit-log",
        contractPackage: "@langwatch/enterprise-audit-log-contract",
        serverPackage: "@langwatch/enterprise-audit-log-server",
      },
      {
        id: "billing",
        contractPackage: "@langwatch/enterprise-billing-contract",
        serverPackage: "@langwatch/enterprise-billing-server",
        webPackage: "@langwatch/enterprise-billing-web",
      },
      {
        id: "governance",
        contractPackage: "@langwatch/enterprise-governance-contract",
        serverPackage: "@langwatch/enterprise-governance-server",
        webPackage: "@langwatch/enterprise-governance-web",
      },
      {
        id: "managed-provider",
        contractPackage: "@langwatch/enterprise-managed-provider-contract",
        serverPackage: "@langwatch/enterprise-managed-provider-server",
        webPackage: "@langwatch/enterprise-managed-provider-web",
      },
      {
        id: "saas",
        contractPackage: "@langwatch/enterprise-saas-contract",
        webPackage: "@langwatch/enterprise-saas-web",
      },
      {
        id: "webhook",
        contractPackage: "@langwatch/enterprise-webhook-contract",
        serverPackage: "@langwatch/enterprise-webhook-server",
      },
    ]);
  });
});
