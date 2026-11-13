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
import { recordedKeyCredentialOf } from "./credential.ts";
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
  ipAddress: string | null;
  userAgent: string | null;
}>;

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
  spends,
}: {
  gate: RestStaffAccessGate | undefined;
  servedDoors: boolean;
  credential: string;
  request: Request;
  operation: string;
  permissions: readonly string[];
  scope: AuthzDeclaredScopeId | null;
  spends: boolean;
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
  const receipt = await gate.admit({
    apiKeyId: key.apiKeyId,
    method: request.method,
    path: new URL(request.url).pathname,
    operation,
    permissions,
    scope,
    spends,
    ipAddress: ClientAddress.resolvedFor(request) ?? null,
    userAgent: request.headers.get("user-agent"),
  });

  Object.defineProperty(request, ADMITTED_STAFF, { value: receipt.staff, enumerable: false });

  return { receipt, startedAt };
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
