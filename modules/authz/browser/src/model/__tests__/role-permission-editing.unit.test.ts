/**
 * The composer's tick arithmetic, as the custom-role editor spec states it.
 * Spec: specs/rbac/custom-role-permission-editing.feature
 */
import { isRegistryPermission } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";

import { ORDERED_RESOURCES } from "../permission-catalogue.ts";
import { offeredPermissions, withDependencies, withoutDependents } from "../role-permissions.ts";

const DATASETS = offeredPermissions("datasets");

function datasets(action: string) {
  const permission = DATASETS.find((candidate) => candidate === `datasets:${action}`);
  if (!permission) throw new Error(`datasets:${action} is not offered`);
  return permission;
}

describe("given a role being edited one resource at a time", () => {
  /** @scenario Ticking manage grants every action on its resource */
  it("grants every offered action when manage is ticked", () => {
    const next = withDependencies({
      resource: "datasets",
      permission: datasets("manage"),
      selected: [],
    });
    expect([...next].sort()).toEqual([...DATASETS].sort());
  });

  /** @scenario Ticking a write action grants view with it */
  it("grants view along with a write", () => {
    const next = withDependencies({
      resource: "datasets",
      permission: datasets("update"),
      selected: [],
    });
    expect([...next].sort()).toEqual([datasets("update"), datasets("view")].sort());
  });

  /** @scenario Unticking view withdraws the writes that depend on it */
  it("withdraws the writes when view goes", () => {
    const selected = [datasets("view"), datasets("create"), datasets("update")];
    expect(
      withoutDependents({ resource: "datasets", permission: datasets("view"), selected }),
    ).toEqual([]);
  });

  /** @scenario Unticking a write leaves the view it pulled in */
  it("keeps view when a write goes", () => {
    const selected = [datasets("view"), datasets("create")];
    expect(
      withoutDependents({ resource: "datasets", permission: datasets("create"), selected }),
    ).toEqual([datasets("view")]);
  });

  /** @scenario Unticking manage withdraws everything it granted */
  it("withdraws everything when manage goes", () => {
    expect(
      withoutDependents({
        resource: "datasets",
        permission: datasets("manage"),
        selected: DATASETS,
      }),
    ).toEqual([]);
  });

  /** @scenario The editor never offers a permission the engine cannot grant */
  it("offers only permissions the registry knows", () => {
    const offered = ORDERED_RESOURCES.flatMap((resource) => offeredPermissions(resource));
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.filter((permission) => !isRegistryPermission(permission))).toEqual([]);
  });
});
