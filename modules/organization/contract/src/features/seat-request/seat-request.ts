import { signInIdpKindSchema, type SignInIdpKind } from "@langwatch/identity-contract";
import type { Named } from "@langwatch/module";
/**
 * Seat requests: a person asked for a full seat the organization had no room for
 * (modules/organization/specs/seat-requests.feature).
 */
import { z } from "zod";

/** How the person was left when the request opened; `requested`: a member asked from a refusal. */
export type SeatRequestSource = "pending" | "lite" | "idp_refused" | "requested";
export type SeatRequestStatus = "OPEN" | "APPROVED" | "DECLINED";

const seatRequestSchemaDefinition = z.object({
  id: z.string().min(1),
  email: z.string(),
  name: z.string().nullable(),
  userId: z.string().nullable(),
  source: z.enum(["pending", "lite", "idp_refused", "requested"]),
  idpRefused: z.boolean(),
  idpKind: signInIdpKindSchema.nullable(),
  /** What a member who asked was trying to do, in the server's words; null for arrivals. */
  reason: z.string().nullable(),
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
 * What a member was trying to do when refused, one of the refusals' fixed reasons. The server
 * renders each one's words for admins, so a member never puts their own text in a mail.
 */
export const seatRequestReasonSchema = z.enum([
  "run_experiments",
  "save_prompts",
  "edit_datasets",
  "build_workflows",
  "run_scenarios",
  "annotate_traces",
  "set_up_automations",
  "change_project_settings",
  "edit_dashboards",
  "add_to_workspace",
  "use_feature",
]);
export type SeatRequestReason = z.infer<typeof seatRequestReasonSchema>;

/** A member refused for want of a full seat asks for one (seat-requests.feature, member asks). */
const requestSeatAccessInputSchemaDefinition = z.object({
  organizationId: z.string().min(1),
  reason: seatRequestReasonSchema.optional(),
});
export interface RequestSeatAccessInputSchema extends Named<
  typeof requestSeatAccessInputSchemaDefinition
> {}
export const requestSeatAccessInputSchema: RequestSeatAccessInputSchema =
  requestSeatAccessInputSchemaDefinition;
export type RequestSeatAccessInput = z.infer<typeof requestSeatAccessInputSchema>;

/** The caller's own latest seat request in one organization, as Request access reads it. */
const myAccessRequestSchemaDefinition = z.object({
  status: z.enum(["none", "open", "approved", "declined"]),
  /** Epoch milliseconds; null when there is no request. */
  openedAt: z.number().nullable(),
  resolvedAt: z.number().nullable(),
});
export interface MyAccessRequestSchema extends Named<typeof myAccessRequestSchemaDefinition> {}
export const myAccessRequestSchema: MyAccessRequestSchema = myAccessRequestSchemaDefinition;
export type MyAccessRequest = z.infer<typeof myAccessRequestSchema>;

/**
 * Approve that buys the full seat it needs in one click: approved at once, or a Stripe page the
 * customer finishes first. `paymentRef` is handed back to `completeSeatApproval` as it is.
 */
const seatApprovalWithSeatSchemaDefinition = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("approved"),
    outcome: seatRequestResolvedSchemaDefinition.shape.outcome,
    seatAdded: z.boolean(),
  }),
  z.object({
    status: z.literal("payment_required"),
    url: z.string().url(),
    paymentRef: z.string().min(1),
  }),
]);
export interface SeatApprovalWithSeatSchema extends Named<
  typeof seatApprovalWithSeatSchemaDefinition
> {}
export const seatApprovalWithSeatSchema: SeatApprovalWithSeatSchema =
  seatApprovalWithSeatSchemaDefinition;
export type SeatApprovalWithSeat = z.infer<typeof seatApprovalWithSeatSchema>;

const completeSeatApprovalInputSchemaDefinition = z.object({
  ...seatRequestScopeSchemaDefinition.shape,
  paymentRef: z.string().min(1).max(2000),
});
export interface CompleteSeatApprovalInputSchema extends Named<
  typeof completeSeatApprovalInputSchemaDefinition
> {}
export const completeSeatApprovalInputSchema: CompleteSeatApprovalInputSchema =
  completeSeatApprovalInputSchemaDefinition;
export type CompleteSeatApprovalInput = z.infer<typeof completeSeatApprovalInputSchema>;

/** A seat payment settled: the request approved, the page still open, or over unpaid. */
const seatApprovalCompletionSchemaDefinition = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("approved"),
    outcome: seatRequestResolvedSchemaDefinition.shape.outcome,
  }),
  z.object({ status: z.literal("waiting") }),
  z.object({ status: z.literal("failed") }),
]);
export interface SeatApprovalCompletionSchema extends Named<
  typeof seatApprovalCompletionSchemaDefinition
> {}
export const seatApprovalCompletionSchema: SeatApprovalCompletionSchema =
  seatApprovalCompletionSchemaDefinition;
export type SeatApprovalCompletion = z.infer<typeof seatApprovalCompletionSchema>;

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
