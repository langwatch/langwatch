/**
 * @see modules/staff-access/specs/staff-access-use.feature
 */
import { isRegistryPermission } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { bindingScopeCanGrantPermission } from "../scope.ts";
import {
  STAFF_READER_CONTENT_PERMISSIONS,
  STAFF_READER_METADATA_PERMISSIONS,
  STAFF_SUPPORT_WRITE_PERMISSIONS,
  STAFF_WRITES_WITHOUT_SPEND,
  staffAccessPermissions,
} from "../staff-roles.ts";

const READER = [...STAFF_READER_METADATA_PERMISSIONS, ...STAFF_READER_CONTENT_PERMISSIONS];
const SUPPORT = [...STAFF_READER_METADATA_PERMISSIONS, ...STAFF_SUPPORT_WRITE_PERMISSIONS];
const FORBIDDEN_RESOURCES = [
  "secrets",
  "virtualKeys",
  "gatewayProviders",
  "sso",
  "organization",
  "team",
  "webhookEndpoints",
  "ingestionSources",
  "governance",
  "langy",
  "playground",
  "ops",
  "opsRead",
  "auditLog",
  "gatewaySpend",
];

describe("the staff permission bags", () => {
  /** @scenario "The staff roles hold no credential, member, billing or delete permission" */
  it("hold no credential, member, billing, ops, delete or manage permission", () => {
    for (const permission of [...READER, ...SUPPORT]) {
      const [resource, action] = permission.split(":");
      expect(FORBIDDEN_RESOURCES, permission).not.toContain(resource);
      expect(["delete", "manage"], permission).not.toContain(action);
    }
    for (const permission of READER) {
      expect(["create", "update"], permission).not.toContain(permission.split(":")[1]);
    }
  });

  /** @scenario "The support bag holds no prompt or trigger write" */
  it("holds no prompt or trigger write, since one deploys a prompt and the other sends data out", () => {
    for (const permission of STAFF_SUPPORT_WRITE_PERMISSIONS) {
      expect(["prompts", "triggers"], permission).not.toContain(permission.split(":")[0]);
    }
  });

  it("keeps prompt text out of the metadata bag", () => {
    expect(STAFF_READER_METADATA_PERMISSIONS).not.toContain("prompts:view");
    expect(STAFF_READER_CONTENT_PERMISSIONS).toContain("prompts:view");
  });

  it("lets a support key write without the spend tick only to datasets, all inside its bag", () => {
    expect(STAFF_WRITES_WITHOUT_SPEND.toSorted()).toEqual(["datasets:create", "datasets:update"]);
    for (const permission of STAFF_WRITES_WITHOUT_SPEND) {
      expect(STAFF_SUPPORT_WRITE_PERMISSIONS).toContain(permission);
    }
  });

  it("names only registry permissions an organization binding can grant", () => {
    for (const permission of [...READER, ...SUPPORT]) {
      expect(isRegistryPermission(permission), permission).toBe(true);
      expect(bindingScopeCanGrantPermission({ scopeType: "ORGANIZATION", permission })).toBe(true);
    }
  });
});

describe("staffAccessPermissions", () => {
  /** @scenario "Scopes map to permission bags" */
  it("gives metadata no trace read, content trace reads, and support the write bag", () => {
    const metadata = staffAccessPermissions({ scopes: ["org:metadata"] });
    const content = staffAccessPermissions({ scopes: ["org:content"] });
    const support = staffAccessPermissions({ scopes: ["org:support"] });

    expect(metadata.toSorted()).toEqual([...STAFF_READER_METADATA_PERMISSIONS].toSorted());
    expect(metadata).not.toContain("traces:view");
    expect(content).toContain("traces:view");
    expect(content.toSorted()).toEqual(READER.toSorted());
    expect(support.toSorted()).toEqual(SUPPORT.toSorted());
    expect(support).not.toContain("traces:view");
  });

  it("combines content and support, each permission once", () => {
    const both = staffAccessPermissions({ scopes: ["org:content", "org:support", "ops:read"] });

    expect(new Set(both).size).toBe(both.length);
    expect(both.toSorted()).toEqual([...new Set([...READER, ...SUPPORT])].toSorted());
  });

  it("grants nothing in an organization for ops:read alone", () => {
    expect(staffAccessPermissions({ scopes: ["ops:read"] })).toEqual([]);
  });
});
