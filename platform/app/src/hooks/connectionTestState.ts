import { explainSerializedError } from "../features/errors";
import type {
  UncheckedReason,
  ValidationResult,
} from "../server/modelProviders/providerValidation";

/**
 * A credential check's verdict, in the terms a surface renders.
 *
 * Pulled out of the list's hook once the drawer needed the same three states.
 * It is a plain function rather than a hook because nothing here is stateful,
 * and because the exhaustiveness check at the bottom is worth having in one
 * place: a fourth outcome on the server should be a compile error, not a
 * confident sentence about a verdict nobody has classified.
 *
 * `import type` and not a value import: the module that owns `ValidationResult`
 * reaches the provider repository, and through it Prisma and the encryption
 * helpers. Types are erased, so this costs nothing at runtime and buys the one
 * thing a redeclaration cannot — a rename on the server becomes a type error
 * here instead of a sentence that quietly stops being true.
 */
export type ConnectionTestState =
  | { status: "testing" }
  | { status: "works" }
  | { status: "refused"; message: string }
  | {
      status: "unchecked";
      /**
       * Why nothing was checked. `request_failed` is the local one: we never
       * got an answer at all, as opposed to the server answering that it chose
       * not to ask. Kept apart because a surface can act on some of the
       * server's reasons and can only ever apologize for this one.
       */
      reason: UncheckedReason | "request_failed";
      message: string;
    };

/**
 * What to say when the check never ran, on a surface that is only reading.
 *
 * Deliberately short of the reason we hold internally. "This provider signs
 * every request with AWS credentials, which a listing endpoint does not
 * exercise" is true and is not the customer's problem; what they need to know
 * is whether they still have something to do.
 *
 * The drawer overrides two of these, because there the same reason means
 * something a customer can act on — see `useCredentialCheck`.
 */
export const uncheckedMessage = (reason: UncheckedReason): string => {
  if (reason === "no_credential" || reason === "credential_masked") {
    // Not "nothing is stored": a credential written before the encryption
    // secret was rotated is unreadable rather than absent, and the two are
    // indistinguishable by the time they reach here (the repository drops an
    // undecryptable value to null). Telling that customer to enter a key they
    // already entered is the misdiagnosis this whole area exists to avoid.
    return "No credential could be read for this provider.";
  }
  return "This provider can't be tested automatically — its settings are checked when you first use it.";
};

/**
 * A verdict, turned into what the surface should say.
 *
 * @param result - The server's answer, whichever route asked for it. Both the
 *   stored-credential check and the typed-credential one return this shape, so
 *   one mapping covers the list and the drawer.
 * @param describeUnchecked - Copy for a check that did not run. Defaults to the
 *   reading-only wording above. Named rather than positional, so the second
 *   argument still reads at the call site once a third exists.
 */
export function toConnectionTestState({
  result,
  describeUnchecked = uncheckedMessage,
}: {
  result: ValidationResult;
  describeUnchecked?: (reason: UncheckedReason) => string;
}): ConnectionTestState {
  if (result.outcome === "verified") {
    return { status: "works" };
  }

  if (result.outcome === "refused") {
    // The refusal is a serialized handled error riding on the payload, so it
    // is read with `explainSerializedError` rather than `describeError`. Both
    // land in the same code-keyed registry; only the transport differs. The
    // provider's own sentence never appears in either — a rejected-credential
    // body is where the credential itself tends to turn up.
    const { title, description } = explainSerializedError(result.domainError);
    return {
      status: "refused",
      message: description ? `${title}. ${description}` : title,
    };
  }

  if (result.outcome === "unchecked") {
    return {
      status: "unchecked",
      reason: result.reason,
      message: describeUnchecked(result.reason),
    };
  }

  // A fourth outcome would otherwise fall into the branch above and be
  // described as "can't be tested automatically" — a confident sentence about
  // a verdict nobody has classified. This turns that into a compile error at
  // the moment the server grows one.
  //
  // The discriminator only, never the payload: this message can reach a
  // customer through the caller's catch, and nothing promises a future
  // outcome's fields are free of credential material.
  const unhandled: never = result;
  throw new Error(
    `Unhandled connection test outcome: ${String(
      (unhandled as { outcome?: unknown }).outcome,
    )}`,
  );
}
