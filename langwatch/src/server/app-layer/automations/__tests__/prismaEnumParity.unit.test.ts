import {
  AlertType as PackageAlertType,
  TriggerAction as PackageTriggerAction,
} from "@langwatch/automations";
import {
  AlertType as PrismaAlertType,
  TriggerAction as PrismaTriggerAction,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

/**
 * @langwatch/automations owns copies of the Prisma enums so that CLI/MCP/web
 * consumers need no database dependency. These assertions pin the two in
 * lockstep — adding a value to either side without the other fails here.
 * The type-level checks fail the typecheck on drift in either direction.
 */

type AssertMutuallyAssignable<A, B> = A extends B
  ? B extends A
    ? true
    : never
  : never;

const _triggerActionParity: AssertMutuallyAssignable<
  PackageTriggerAction,
  PrismaTriggerAction
> = true;
const _alertTypeParity: AssertMutuallyAssignable<
  PackageAlertType,
  PrismaAlertType
> = true;

describe("prisma enum parity", () => {
  describe("when the package enums are compared to the Prisma enums", () => {
    it("keeps TriggerAction values identical", () => {
      expect(Object.values(PackageTriggerAction).sort()).toEqual(
        Object.values(PrismaTriggerAction).sort(),
      );
    });

    it("keeps AlertType values identical", () => {
      expect(Object.values(PackageAlertType).sort()).toEqual(
        Object.values(PrismaAlertType).sort(),
      );
    });
  });
});
