import { signInIdpKindSchema, type SignInIdpKind } from "@langwatch/identity-contract";
import type { Named } from "@langwatch/module";
/**
 * Seat requests: a person asked for a full seat the organization had no room for
 * (modules/organization/specs/seat-requests.feature).
 */
import { z } from "zod";

/** How the person was left when the request opened. */
export type SeatRequestSource = "pending" | "lite" | "idp_refused";
export type SeatRequestStatus = "OPEN" | "APPROVED" | "DECLINED";

const seatRequestSchemaDefinition = z.object({
  id: z.string().min(1),
  email: z.string(),
  name: z.string().nullable(),
  userId: z.string().nullable(),
  source: z.enum(["pending", "lite", "idp_refused"]),
  idpRefused: z.boolean(),
  idpKind: signInIdpKindSchema.nullable(),
  /** Epoch milliseconds. */
  openedAt: z.number(),
});
export interface SeatRequestSchema extends Named<typeof seatRequestSchemaDefinition> {}
export const seatRequestSchema: SeatRequestSchema = seatRequestSchemaDefinition;
export type SeatRequest = z.infer<typeof seatRequestSchema>;

/** How an administrator approves a seat, answered per organization (ruling R6). */
const seatApprovalPathSchemaDefinition = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("stripe_seats"),
    /** The seats the subscription pays for now, and with one more. */
    currentSeats: z.number().int().nonnegative(),
    newSeats: z.number().int().positive(),
    /** The active plan type the seat change is made on. */
    planType: z.string(),
    seatPrice: z.object({ amount: z.number(), currency: z.enum(["USD", "EUR"]) }).nullable(),
  }),
  z.object({ kind: z.literal("upgrade_plan"), url: z.string() }),
  z.object({ kind: z.literal("contact_sales"), url: z.string() }),
  z.object({ kind: z.literal("upgrade_licence"), url: z.string() }),
]);
export interface SeatApprovalPathSchema extends Named<typeof seatApprovalPathSchemaDefinition> {}
export const seatApprovalPathSchema: SeatApprovalPathSchema = seatApprovalPathSchemaDefinition;
export type SeatApprovalPath = z.infer<typeof seatApprovalPathSchema>;
export type SeatApprovalPathKind = SeatApprovalPath["kind"];

const openSeatRequestsSchemaDefinition = z.object({
  requests: z.array(seatRequestSchema),
  /** A full seat is free already, so Approve needs no payment step. */
  seatFree: z.boolean(),
  approvalPath: seatApprovalPathSchema,
});
export interface OpenSeatRequestsSchema extends Named<typeof openSeatRequestsSchemaDefinition> {}
export const openSeatRequestsSchema: OpenSeatRequestsSchema = openSeatRequestsSchemaDefinition;
export type OpenSeatRequests = z.infer<typeof openSeatRequestsSchema>;

const seatRequestScopeSchemaDefinition = z.object({
  organizationId: z.string().min(1),
  seatRequestId: z.string().min(1),
});
export interface SeatRequestScopeSchema extends Named<typeof seatRequestScopeSchemaDefinition> {}
export const seatRequestScopeSchema: SeatRequestScopeSchema = seatRequestScopeSchemaDefinition;
export type SeatRequestScope = z.infer<typeof seatRequestScopeSchema>;

const seatRequestResolvedSchemaDefinition = z.object({
  outcome: z.enum(["enabled", "promoted", "invited", "already_member", "declined"]),
});
export interface SeatRequestResolvedSchema extends Named<
  typeof seatRequestResolvedSchemaDefinition
> {}
export const seatRequestResolvedSchema: SeatRequestResolvedSchema =
  seatRequestResolvedSchemaDefinition;
export type SeatRequestResolved = z.infer<typeof seatRequestResolvedSchema>;

/**
 * A membership the signed-in person holds but cannot use: held for want of a seat, or turned off
 * by an administrator. Contacts are active administrators first, then Billing members.
 */
const heldMembershipSchemaDefinition = z.object({
  organizationId: z.string(),
  organizationName: z.string(),
  reason: z.enum(["seat_limit", "access_turned_off"]),
  contacts: z.array(z.object({ name: z.string(), email: z.string().nullable() })),
});
export interface HeldMembershipSchema extends Named<typeof heldMembershipSchemaDefinition> {}
export const heldMembershipSchema: HeldMembershipSchema = heldMembershipSchemaDefinition;
export type HeldMembership = z.infer<typeof heldMembershipSchema>;

const heldMembershipsSchemaDefinition = z.object({
  /** Whether the person holds at least one membership they can use. */
  hasActiveMembership: z.boolean(),
  held: z.array(heldMembershipSchema),
});
export interface HeldMembershipsSchema extends Named<typeof heldMembershipsSchemaDefinition> {}
export const heldMembershipsSchema: HeldMembershipsSchema = heldMembershipsSchemaDefinition;
export type HeldMemberships = z.infer<typeof heldMembershipsSchema>;

/** Identity's question after an identity provider refused a sign-in it could tie to an address. */
export type RecordRefusedSignInInput = Readonly<{
  organizationId: string;
  email: string;
  idp: SignInIdpKind | null;
}>;
/** `seat_limit` when an arrival would have been held pending: show the seat-limit screen first. */
export type RefusedSignInOutcome = Readonly<{ outcome: "seat_limit" | "refused" }>;
