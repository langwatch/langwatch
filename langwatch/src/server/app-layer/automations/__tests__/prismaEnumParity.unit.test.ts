import {
  AlertType as PackageAlertType,
  TriggerAction as PackageTriggerAction,
  TriggerKind as PackageTriggerKind,
} from "@langwatch/automations";
import {
  AlertType as PrismaAlertType,
  TriggerAction as PrismaTriggerAction,
  TriggerKind as PrismaTriggerKind,
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
const _triggerKindParity: AssertMutuallyAssignable<
  PackageTriggerKind,
  PrismaTriggerKind
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

    it("keeps TriggerKind values identical", () => {
      expect(Object.values(PackageTriggerKind).sort()).toEqual(
        Object.values(PrismaTriggerKind).sort(),
      );
    });
  });
});
