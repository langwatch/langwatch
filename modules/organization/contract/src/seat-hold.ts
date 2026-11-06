/**
 * The 30-day seat hold as the remove dialog and the Users list read it
 * (specs/licensing/seat-rotation.feature).
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** Removing one member, optionally giving their freed seat to a person waiting for one. */
const organizationApiRemoveMemberInputSchemaDefinition = z.object({
  organizationId: z.string(),
  userId: z.string(),
  /** A person waiting for a full seat; admitted only when the seat frees at once and fits. */
  giveSeatToUserId: z.string().min(1).nullish(),
});
export interface OrganizationApiRemoveMemberInputSchema extends Named<
  typeof organizationApiRemoveMemberInputSchemaDefinition
> {}
export const organizationApiRemoveMemberInputSchema: OrganizationApiRemoveMemberInputSchema =
  organizationApiRemoveMemberInputSchemaDefinition;
export type OrganizationApiRemoveMemberInput = z.infer<
  typeof organizationApiRemoveMemberInputSchema
>;

/** The removal happened; who got the freed seat, if anyone. */
const organizationMemberRemovedSchemaDefinition = z
  .object({ success: z.literal(true), seatGivenToUserId: z.string().nullable() })
  .strict();
export interface OrganizationMemberRemovedSchema extends Named<
  typeof organizationMemberRemovedSchemaDefinition
> {}
export const organizationMemberRemovedSchema: OrganizationMemberRemovedSchema =
  organizationMemberRemovedSchemaDefinition;
export type OrganizationMemberRemoved = z.infer<typeof organizationMemberRemovedSchema>;

/** A person waiting for a full seat. */
const organizationSeatWaiterSchemaDefinition = z
  .object({ userId: z.string(), name: z.string().nullable(), email: z.string().nullable() })
  .strict();

/** What removing a member does to their seat. */
const organizationSeatRemovalPreviewSchemaDefinition = z
  .object({
    /** Whether the member holds a full seat the removal stops them holding. */
    holdsFullSeat: z.boolean(),
    /** When the seat frees: null when it frees at once, or when there is no full seat. */
    seatFreesAt: z.date().nullable(),
    /** The person waiting longest, offered the seat only when it frees at once. */
    waiting: organizationSeatWaiterSchemaDefinition.nullable(),
  })
  .strict();
export interface OrganizationSeatRemovalPreviewSchema extends Named<
  typeof organizationSeatRemovalPreviewSchemaDefinition
> {}
export const organizationSeatRemovalPreviewSchema: OrganizationSeatRemovalPreviewSchema =
  organizationSeatRemovalPreviewSchemaDefinition;
export type OrganizationSeatRemovalPreview = z.infer<typeof organizationSeatRemovalPreviewSchema>;

/** One seat still held after its person was removed, disabled or demoted. */
const organizationHeldSeatSchemaDefinition = z
  .object({
    userId: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    seatTakenAt: z.date(),
    seatFreesAt: z.date(),
    reason: z.enum(["REMOVED", "DISABLED", "DEMOTED"]),
  })
  .strict();

/** The organization's held seats, ending soonest first. */
const organizationHeldSeatsSchemaDefinition = z
  .object({ heldSeats: z.array(organizationHeldSeatSchemaDefinition) })
  .strict();
export interface OrganizationHeldSeatsSchema extends Named<
  typeof organizationHeldSeatsSchemaDefinition
> {}
export const organizationHeldSeatsSchema: OrganizationHeldSeatsSchema =
  organizationHeldSeatsSchemaDefinition;
export type OrganizationHeldSeats = z.infer<typeof organizationHeldSeatsSchema>;
