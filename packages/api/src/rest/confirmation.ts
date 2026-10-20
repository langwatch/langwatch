/**
 * A route that removes or disables something runs for a Langy session key only once the person
 * clicked Yes on a card for that record. The route declares the mark; the module that shows the
 * cards binds the gate. Other credentials pass. Spec: specs/langy/langy-delete-confirmation.feature
 */
import type { AuthzDeclaredScopeId } from "@langwatch/authorization";

import { ConfirmationRequiredError } from "../errors.ts";
import type { MiddlewareBinding, TransportPeers } from "../hosting/transport-hosts.ts";
import { isKeyDoor, recordedKeyOfDoor } from "./key-credential.ts";

/** What a route that removes or disables something declares about the record it acts on. */
export type RestConfirmation<Api = unknown> = Readonly<{
  /** The kind of record, as the card names it: `evaluator`, `dataset row`. */
  resource: string;
  /** What the route does to it. A click covers one action, so a delete never covers a disable. */
  action: string;
  /** The input field holding the one record's id. Exactly one of this and `idsField`. */
  idParam?: string;
  /** The input field holding a list of ids: every one needs its own click. */
  idsField?: string;
  /** Asks only when this holds, as for a toggle that only sometimes disables. */
  when?: (input: Readonly<Record<string, unknown>>) => boolean;
  /**
   * The record's own name, read from the module that owns it; null when there is none. A method,
   * so a route over one module's app still reads as a route of any app.
   */
  name(args: { app: Api; projectId: string; id: string }): Promise<string | null>;
}>;

/** One request the gate is asked about: which key, which project, which records. */
export type RestConfirmationRequest = Readonly<{
  apiKeyId: string;
  ownerUserId: string | null;
  projectId: string;
  resource: string;
  action: string;
  /** Each record, with its name read only when a card has to show it. */
  targets: readonly Readonly<{ id: string; name: () => Promise<string | null> }>[];
}>;

/** Where the clicks are kept. */
export type RestConfirmationGate = Readonly<{
  /**
   * Spends one click per target, all of them or none of them.
   * @throws {ConfirmationRequiredError} when any target has no unspent click
   */
  confirm(request: RestConfirmationRequest): Promise<void>;
}>;

type ConfirmationGateBinding = Readonly<{ confirmationGate: RestConfirmationGate }>;

/** The owner's one binding of the gate, among the middleware bindings it provides. */
export function bindConfirmationGate(gate: RestConfirmationGate): ConfirmationGateBinding {
  return { confirmationGate: gate };
}

/**
 * The gate an installed module bound, or none. A process without one still refuses every marked
 * route for a Langy key, so leaving the module out never opens the routes.
 */
export function openConfirmationGate(
  peers: Pick<TransportPeers, "middlewareBindings">,
): RestConfirmationGate | undefined {
  const bound = peers.middlewareBindings.flatMap(({ feature, middlewareBindings }) =>
    middlewareBindings.filter(isConfirmationGateBinding).map(({ confirmationGate }) => ({
      feature,
      confirmationGate,
    })),
  );
  if (bound.length > 1) {
    throw new Error(
      `The confirmation gate is bound by: ${bound.map(({ feature }) => feature).join(", ")}. Exactly one module binds it.`,
    );
  }

  return bound[0]?.confirmationGate;
}

function isConfirmationGateBinding(binding: MiddlewareBinding): binding is ConfirmationGateBinding {
  return "confirmationGate" in binding;
}

/** Refuses a mark that could never name the record it guards. */
export function assertConfirmationMark({
  address,
  mark,
}: {
  address: string;
  mark: RestConfirmation<never>;
}): void {
  if (!/^[a-z][a-z ]*$/.test(mark.resource)) {
    throw new Error(`${address} confirmation resource "${mark.resource}" must be lowercase words`);
  }
  if (!/^[a-z]+$/.test(mark.action)) {
    throw new Error(`${address} confirmation action "${mark.action}" must be one lowercase word`);
  }
  if ((mark.idParam === undefined) === (mark.idsField === undefined)) {
    throw new Error(`${address} confirmation names exactly one of idParam and idsField`);
  }
}

/**
 * The gate's question for one request, or nothing to ask: only a Langy session key on a marked
 * route is asked, and a mark whose `when` does not hold asks nothing.
 * @throws {ConfirmationRequiredError} when the request cannot be confirmed at all
 */
export async function confirmMarkedRequest<Api>({
  mark,
  gate,
  credential,
  request,
  input,
  scope,
  app,
}: {
  mark: RestConfirmation<Api> | undefined;
  gate: RestConfirmationGate | undefined;
  credential: string;
  request: Request;
  input: unknown;
  scope: AuthzDeclaredScopeId | null;
  app: () => Api;
}): Promise<void> {
  if (!mark || !isKeyDoor(credential)) return;
  const key = recordedKeyOfDoor({ door: credential, request });
  if (key?.kind !== "langy_session_key") return;

  const fields = (input ?? {}) as Readonly<Record<string, unknown>>;
  if (mark.when && !mark.when(fields)) return;

  const ids = idsOf({ mark, fields });
  if (!gate || !key.apiKeyId || scope?.tier !== "project" || ids.length === 0) {
    throw new ConfirmationRequiredError({
      message:
        "Deleting needs a confirmation click, and no confirmation card can be shown for this request.",
      resource: mark.resource,
      action: mark.action,
    });
  }

  const projectId = scope.id;
  await gate.confirm({
    apiKeyId: key.apiKeyId,
    ownerUserId: key.ownerUserId,
    projectId,
    resource: mark.resource,
    action: mark.action,
    targets: ids.map((id) => ({ id, name: () => mark.name({ app: app(), projectId, id }) })),
  });
}

/** The ids the request names, each once, in the order it named them. */
function idsOf<Api>({
  mark,
  fields,
}: {
  mark: RestConfirmation<Api>;
  fields: Readonly<Record<string, unknown>>;
}): string[] {
  const named = mark.idParam !== undefined ? [fields[mark.idParam]] : fields[mark.idsField ?? ""];
  if (!Array.isArray(named)) return [];

  return [...new Set(named.filter((id): id is string => typeof id === "string" && id !== ""))];
}
