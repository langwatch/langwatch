import {
  AlertType as PackageAlertType,
  TriggerAction as PackageTriggerAction,
  TriggerKind as PackageTriggerKind,
} from "@langwatch/automations";
import type { CustomGraphRow } from "@langwatch/automations/domain/custom-graph";
import type {
  TriggerCreateData,
  TriggerRow,
  TriggerUpdateData,
} from "@langwatch/automations/domain/trigger";
import { WebhookDeliveryOutcome as PackageWebhookDeliveryOutcome } from "@langwatch/automations";
import {
  AlertType as PrismaAlertType,
  TriggerAction as PrismaTriggerAction,
  TriggerKind as PrismaTriggerKind,
  WebhookDeliveryOutcome as PrismaWebhookDeliveryOutcome,
  type CustomGraph as PrismaCustomGraph,
  type Prisma,
  type Trigger as PrismaTrigger,
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

// The domain TriggerRow (ADR-063) mirrors the Prisma Trigger scalars: every
// generated row must satisfy the domain shape, and neither side may grow a
// column the other lacks.
const _triggerRowAssignable: PrismaTrigger extends TriggerRow ? true : never =
  true;
const _triggerRowKeysParity: AssertMutuallyAssignable<
  keyof PrismaTrigger,
  keyof TriggerRow
> = true;
const _webhookOutcomeParity: AssertMutuallyAssignable<
  PackageWebhookDeliveryOutcome,
  PrismaWebhookDeliveryOutcome
> = true;
const _customGraphRowAssignable: PrismaCustomGraph extends CustomGraphRow
  ? true
  : never = true;
const _customGraphRowKeysParity: AssertMutuallyAssignable<
  keyof PrismaCustomGraph,
  keyof CustomGraphRow
> = true;
// Write shapes pass through to Prisma unchanged — they must stay assignable
// to the generated input types.
const _triggerCreateAssignable: TriggerCreateData extends Prisma.TriggerUncheckedCreateInput
  ? true
  : never = true;
const _triggerUpdateAssignable: TriggerUpdateData extends Prisma.TriggerUncheckedUpdateInput
  ? true
  : never = true;

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

    it("keeps WebhookDeliveryOutcome values identical", () => {
      expect(Object.values(PackageWebhookDeliveryOutcome).sort()).toEqual(
        Object.values(PrismaWebhookDeliveryOutcome).sort(),
      );
    });
  });
});
