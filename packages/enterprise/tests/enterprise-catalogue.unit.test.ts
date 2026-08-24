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
        id: "admin",
        contractPackage: "@langwatch/enterprise-admin-contract",
        serverPackage: "@langwatch/enterprise-admin-server",
        webPackage: "@langwatch/enterprise-admin-web",
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
        id: "managed-providers",
        contractPackage: "@langwatch/enterprise-managed-providers-contract",
        serverPackage: "@langwatch/enterprise-managed-providers-server",
        webPackage: "@langwatch/enterprise-managed-providers-web",
      },
      {
        id: "saas",
        contractPackage: "@langwatch/enterprise-saas-contract",
        webPackage: "@langwatch/enterprise-saas-web",
      },
      {
        id: "webhooks",
        contractPackage: "@langwatch/enterprise-webhooks-contract",
        serverPackage: "@langwatch/enterprise-webhooks-server",
      },
    ]);
  });
});
