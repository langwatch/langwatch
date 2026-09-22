/**
 * What the sign-in and sign-up screens report, and the only place their event
 * names are written down.
 *
 * These screens carried NO analytics at all, which made the one funnel that
 * decides whether anybody becomes a customer the one funnel nobody could see.
 * Not "under-measured" — unmeasured: no view, no step, no drop-off, no
 * refusal. A change to this flow could only be judged by whether anybody
 * complained.
 *
 * ── Why the names live here ─────────────────────────────────────────────
 *
 * A boundary name typed inline at each of a dozen `return`s is a name that
 * drifts: one screen says `check_email` and another `check-your-email`, and
 * the funnel silently has two steps where it should have one. They are
 * constants, in one file, so the dashboard's step list and the code's step
 * list cannot come apart.
 *
 * ── What is deliberately NOT reported ───────────────────────────────────
 *
 * The address. Every event on these screens is about somebody who has not
 * signed in yet, and an email address on an analytics event is a personal
 * identifier travelling to a third party for a person who has agreed to
 * nothing — and it would sit in whatever the analytics provider keeps. What
 * IS useful about the address is its SHAPE, so where a step depends on it,
 * these carry a boolean (`hadCarriedAddress`) rather than the thing itself.
 *
 * Likewise no token, no error message, no provider secret. A refusal reports
 * its stable `code`, which is what a dashboard can group by anyway — the
 * message is copy and changes.
 */

/** The two screens, as the funnel names them. */
export const AUTH_SURFACE = {
  signIn: "sign_in",
  signUp: "sign_up",
  forgotPassword: "forgot_password",
  resetPassword: "reset_password",
  verifyEmail: "verify_email",
  inviteLanding: "invite_landing",
} as const;

/**
 * The steps of the log-in screen, in the order the component's returns are
 * written in — which is the order somebody meets them.
 */
export const SIGN_IN_STEP = {
  /** The address field, which is where all but one journey starts. */
  address: "address",
  /** A password was accepted and a second factor is owed. */
  challenge: "challenge",
  /** A WebAuthn prompt is open and the card is waiting on the device. */
  passkeyCeremony: "passkey_ceremony",
  /** Handing off to the organization's identity provider. */
  routedToConnection: "routed_to_connection",
  /** Nobody holds this address, so the journey is a sign-up. */
  signUpHandoff: "sign_up_handoff",
  /** The methods this account holds. */
  methodPicker: "method_picker",
  /** A link was sent and the screen is waiting on an inbox. */
  checkEmail: "check_email",
  /** A refusal that took the whole card. */
  error: "error",
} as const;

/** The steps of the sign-up screen, same ordering rule. */
export const SIGN_UP_STEP = {
  address: "address",
  challenge: "challenge",
  passkeyCeremony: "passkey_ceremony",
  /** The domain routes to an identity provider, so the account is made there. */
  routedToConnection: "routed_to_connection",
  /** The address already has an account: this is a log-in in the wrong place. */
  welcomeBack: "welcome_back",
  /** Choosing a password or a passkey — the step that creates the account. */
  credential: "credential",
  /** The account exists and the confirmation link is out. */
  checkEmail: "check_email",
  /** A spent link came back and the account is waiting to be signed into. */
  accountReady: "account_ready",
  /** A confirmed address with no account behind it yet. */
  methodChoice: "method_choice",
  /** Expired, spent, or never issued. */
  linkDead: "link_dead",
} as const;

/**
 * The actions worth counting, as verbs.
 *
 * Past tense throughout, because an analytics event is a report of something
 * that HAS happened — `submitted`, not `submit`. The library takes the action
 * and an optional object name, so "submitted the address" is
 * `emit(AUTH_ACTION.submitted, "address")`.
 */
export const AUTH_ACTION = {
  /** A form was sent to the server. */
  submitted: "submitted",
  /** A way in was chosen off the rail. */
  chose: "chose",
  /** The server refused, and the event carries the code. */
  refused: "refused",
  /** A session now exists. The one event the whole funnel is measured to. */
  signedIn: "signed_in",
  /** An account row now exists, which on this flow is not yet a session. */
  accountCreated: "account_created",
  /** A confirmation or reset link went out. */
  linkSent: "link_sent",
  /** A link came back and was spent. */
  linkConfirmed: "link_confirmed",
  /** A WebAuthn prompt was opened. */
  ceremonyStarted: "ceremony_started",
  /** The person closed the prompt. Not a failure, and counted separately. */
  ceremonyDismissed: "ceremony_dismissed",
} as const;

export type AuthAction = (typeof AUTH_ACTION)[keyof typeof AUTH_ACTION];
