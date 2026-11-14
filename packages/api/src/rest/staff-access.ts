/**
 * Every request an approved staff agent's key makes (ADR-202) passes one gate: after its
 * authorization and before its handler, the gate writes the trail row or refuses. The
 * `staff-access` module binds it; a process with none bound refuses every staff key.
 */
import type { AuthzDeclaredScopeId } from "@langwatch/authorization";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";

import { StaffAccessUnavailableError } from "../errors.ts";
import type { MiddlewareBinding, TransportPeers } from "../hosting/transport-hosts.ts";
import { ClientAddress } from "../policy/client-address.ts";
import { recordAdmittedStaffSpend, recordedKeyCredentialOf } from "./credential.ts";
import { isKeyDoor, keyCredentialOf } from "./key-credential.ts";

const logger = createLogger("langwatch:api:staff-access");

/** One request a staff key makes, as the gate records it. */
export type RestStaffAccessRequest = Readonly<{
  apiKeyId: string;
  method: string;
  path: string;
  /** `${family}.${operation}`. */
  operation: string;
  permissions: readonly string[];
  scope: AuthzDeclaredScopeId | null;
  /** The route starts a run that spends the organization's money (`.spends()`). */
  spends: boolean;
  /** The route changes something, by its declared kind rather than its permissions. */
  writes: boolean;
  /** The route removes or disables a record (`.withConfirmation`). */
  confirms: boolean;
  /** The route answers content under a metadata permission (`.servesContent()`). */
  servesContent: boolean;
  ipAddress: string | null;
  userAgent: string | null;
}>;

/** A staff key's request the runtime refused before the gate admitted it, with its answer. */
export type RestStaffAccessRefusal = RestStaffAccessRequest &
  Readonly<{ status: number; errorCode: string | null }>;

/** How the admitted request ended, told once after the route answered or failed. */
export type RestStaffAccessOutcome = Readonly<{
  status: number;
  errorCode: string | null;
  durationMs: number;
}>;

/** Who stands behind an admitted request, as the customer's audit rows name it. */
export type RestStaffAccessIdentity = Readonly<{
  principal: string;
  approverUserId: string;
  reason: string | null;
}>;

export type RestStaffAccessReceipt = Readonly<{
  staff: RestStaffAccessIdentity;
  /** Whether the session was approved to spend: a handler that may charge reads it. */
  spendApproved: boolean;
  finish(outcome: RestStaffAccessOutcome): Promise<void>;
}>;

const ADMITTED_STAFF = Symbol.for("langwatch.api.staffAccess");

/** The staff identity the gate admitted this request under, or none for any other caller. */
export function admittedStaffOf(request: Request): RestStaffAccessIdentity | undefined {
  return (request as { [ADMITTED_STAFF]?: RestStaffAccessIdentity })[ADMITTED_STAFF];
}

export type RestStaffAccessGate = Readonly<{
  /** Writes the trail row before the handler; throws a HandledError to refuse. */
  admit(request: RestStaffAccessRequest): Promise<RestStaffAccessReceipt>;
  /** Writes the trail row of a request refused before `admit`, such as by its permission. */
  refused(refusal: RestStaffAccessRefusal): Promise<void>;
}>;

export type StaffAccessGateBinding = Readonly<{ staffAccessGate: RestStaffAccessGate }>;

/** The owner's one binding of the gate, among the middleware bindings it provides. */
export function bindStaffAccessGate(gate: RestStaffAccessGate): StaffAccessGateBinding {
  return { staffAccessGate: gate };
}

/** The gate an installed module bound, or none: then every staff key is refused. */
export function openStaffAccessGate(
  peers: Pick<TransportPeers, "middlewareBindings">,
): RestStaffAccessGate | undefined {
  const bound = peers.middlewareBindings.flatMap(({ feature, middlewareBindings }) =>
    middlewareBindings
      .filter(isStaffAccessGateBinding)
      .map(({ staffAccessGate }) => ({ feature, staffAccessGate })),
  );
  if (bound.length > 1) {
    throw new Error(
      `The staff access gate is bound by: ${bound.map(({ feature }) => feature).join(", ")}. Exactly one module binds it.`,
    );
  }

  return bound[0]?.staffAccessGate;
}

function isStaffAccessGateBinding(binding: MiddlewareBinding): binding is StaffAccessGateBinding {
  return "staffAccessGate" in binding;
}

/**
 * The gate's receipt for a staff key's request, or nothing for any other caller. A key door that
 * recorded no key is a wiring fault where doors are served, so it never passes as no staff key.
 * @throws {StaffAccessUnavailableError} for a staff key when no gate is bound
 */
export async function admitStaffRequest({
  gate,
  servedDoors,
  credential,
  request,
  operation,
  permissions,
  scope,
  route,
}: StaffRequestInput & {
  gate: RestStaffAccessGate | undefined;
  servedDoors: boolean;
}): Promise<StaffReceipt | undefined> {
  if (!isKeyDoor(credential)) return undefined;
  const recorded = recordedKeyCredentialOf({ door: credential, request });
  if (!recorded) {
    // A host with a gate serves only doors that record their key; one that does not is a defect.
    if (!servedDoors || !gate) return undefined;
    throw new Error(`The ${credential} door recorded no key, so no staff key can be told apart`);
  }
  const key = keyCredentialOf(recorded);
  if (key.isStaffAccessKey !== true) return undefined;
  if (!gate || !key.apiKeyId) throw new StaffAccessUnavailableError();

  const startedAt = performance.now();
  const receipt = await gate.admit(
    staffRequestOf({ apiKeyId: key.apiKeyId, request, operation, permissions, scope, route }),
  );

  Object.defineProperty(request, ADMITTED_STAFF, { value: receipt.staff, enumerable: false });
  recordAdmittedStaffSpend({ request, spendApproved: receipt.spendApproved });

  return { receipt, startedAt };
}

/** What the runtime knows of a route a staff key called, before or at the gate. */
export type StaffRequestInput = Readonly<{
  credential: string;
  request: Request;
  operation: string;
  permissions: readonly string[];
  scope: AuthzDeclaredScopeId | null;
  route: Readonly<{ spends: boolean; writes: boolean; confirms: boolean; servesContent: boolean }>;
}>;

function staffRequestOf({
  apiKeyId,
  request,
  operation,
  permissions,
  scope,
  route,
}: Omit<StaffRequestInput, "credential"> & { apiKeyId: string }): RestStaffAccessRequest {
  return {
    apiKeyId,
    method: request.method,
    path: new URL(request.url).pathname,
    operation,
    permissions,
    scope,
    ...route,
    ipAddress: ClientAddress.resolvedFor(request) ?? null,
    userAgent: request.headers.get("user-agent"),
  };
}

/**
 * Tells the gate a staff key's request was refused before it was admitted (a permission, a
 * scope or a plan refusal), so the trail holds it too. Silent for any other caller; a failed
 * write is logged, never thrown, so the caller still gets the original refusal.
 */
export async function recordStaffRefusal({
  gate,
  error,
  ...input
}: StaffRequestInput & { gate: RestStaffAccessGate | undefined; error: unknown }): Promise<void> {
  if (!gate || !isKeyDoor(input.credential)) return;
  const recorded = recordedKeyCredentialOf({ door: input.credential, request: input.request });
  if (!recorded) return;
  const key = keyCredentialOf(recorded);
  if (key.isStaffAccessKey !== true || !key.apiKeyId) return;

  const handled = HandledError.isHandled(error) ? error : null;
  await gate
    .refused({
      ...staffRequestOf({ apiKeyId: key.apiKeyId, ...input }),
      status: handled?.httpStatus ?? 500,
      errorCode: handled?.code ?? null,
    })
    .catch((failure: unknown) => {
      logger.warn({ error: failure }, "a refused staff access request could not be recorded");
    });
}

/** An admitted request: the gate's receipt and when the gate let it in. */
export type StaffReceipt = Readonly<{ receipt: RestStaffAccessReceipt; startedAt: number }>;

/**
 * Runs the rest of the request and tells the gate how it ended. The route's own answer or error
 * always wins: a failed `finish` is logged, never thrown.
 */
export async function finishingStaffRequest<Result extends Response | undefined>({
  admitted,
  run,
  statusOf,
}: {
  admitted: StaffReceipt | undefined;
  run: () => Promise<Result>;
  /** The status sent when the route declined to answer itself. */
  statusOf: () => number;
}): Promise<Result> {
  if (!admitted) return run();

  const finish = async (outcome: Omit<RestStaffAccessOutcome, "durationMs">): Promise<void> => {
    const durationMs = Math.round(performance.now() - admitted.startedAt);
    await admitted.receipt.finish({ ...outcome, durationMs }).catch((error: unknown) => {
      logger.warn({ error }, "a staff access request could not record how it ended");
    });
  };
  try {
    const answer = await run();
    await finish({ status: answer?.status ?? statusOf(), errorCode: null });

    return answer;
  } catch (error) {
    const handled = HandledError.isHandled(error) ? error : null;
    await finish({ status: handled?.httpStatus ?? 500, errorCode: handled?.code ?? null });
    throw error;
  }
}
