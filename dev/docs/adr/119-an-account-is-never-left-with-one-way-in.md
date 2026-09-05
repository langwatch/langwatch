# ADR-119: An account is never left with one way in

**Date:** 2026-08-25

**Status:** Proposed

**Program:** Identity platform redesign — epic `../identity-platform-redesign.md`,
plan `../identity-platform/delivery-plan.md`, deliverable
`D07-passkeys.md`. Specs: `specs/identity/passkeys.feature`.

**Builds on:** ADR-117 (the auth screens, whose credential step now creates
passkey-only accounts), ADR-101 (the identifier model, whose detach guards this
complements).

## Context

Passkey sign-up (ADR-117 §6) creates accounts whose only credential is a
passkey on one device. That is the good outcome — it is the phishing-resistant
one — and it introduces a shape the product had never had: an account with no
password at all.

Recovery for such an account does not work, and did not fail loudly:

- `forgot password` issues a link, the link sets a password, and setting a
  password is an `updateMany` over credential rows. An account that never had
  one matches **zero rows**, the update succeeds, and the person is told their
  password was reset. They then cannot sign in with it. A silent no-op is the
  worst available failure — it costs them the recovery attempt AND the belief
  that they have recovered.
- The settings page offered "Change Password" unconditionally, which for such
  an account is a form that can only be rejected: there is no current password
  to prove.

Underneath both is one gap: **nothing let somebody add a credential they did
not already have.** Every path assumed the account arrived with one.

## Decision

**An account can always acquire a second way in, and the surfaces say which
one it is missing.**

Three parts.

### 1. A passkey account is created with an empty credential row

`createPasskeyUser` writes the `Account` row with `password: null` rather than
writing no row at all.

This looks redundant and is the fix for the silent no-op: password reset
updates credential rows *in place*, so recovery needs a row to land on. A row
holding a null password is refused by sign-in exactly as a missing one is —
better-auth hashes a dummy and answers "invalid email or password", so even the
timing does not differ — and it makes the account recoverable.

### 2. Setting a first password is its own operation, and can only fill an empty slot

`user.setPassword` sets a password where there is none. It is separate from
`changePassword` rather than a mode of it, because the two have different
proofs: changing one proves the old one, and setting the first has nothing to
prove.

That missing proof is the whole security question, and the answer is the
refusal: **it can never replace an existing password.** Where one exists it
refuses and `changePassword` is the only way. A stolen session can already read
everything the account can see; what it must not gain is a credential that
outlives the session being revoked. Filling an empty slot still hands it
persistence, so the operation is rate-limited and **ends every other session
the moment it lands**.

### 3. The settings surface offers what is missing, not what is typical

The sign-in methods section reads whether the account has a password and offers
"Set a password" or "Change Password" accordingly. It assumes "has one" until
the answer arrives — flashing "Set a password" at somebody who has one reads as
their password having been lost.

## Consequences

**Passwords come back for passkey users, and that is intended.** A reader could
object that adding a password to a passkey account throws away the
phishing-resistance the passkey bought. It does not: the passkey remains the
credential the sign-in screen offers first and the one autofill surfaces
(ADR-117), and `amr` still records which was actually used, so a policy that
cares can still tell them apart. What the password buys is the ability to get
in from a machine that does not hold the passkey — and an account that cannot
do that is one lost device from a support ticket.

**"No password" becomes a state the product can see.** `user.hasPassword` makes
it a question any surface can ask. The nudge (ADR-120) is the first other
consumer; an org-admin view of members with a single credential is a plausible
second.

**A notification on "a password was set" is deliberately not here.** It is the
standard control for an operation with no re-authentication, and it is worth
building — but it needs a mail template and a decision about what else deserves
one, and bolting it onto this decision would smuggle in a notifications
surface. Named as the follow-up it is.

**The detach guards stay D07's.** "Removing the last way in is refused" and
"removing is refused when nothing is left to recover with" are identifier-model
guards (`specs/identity/passkeys.feature`), and they are the other half of this
ADR's title. This decision makes acquiring a credential possible; those guards
stop the last one being given up. Neither is sufficient alone, and today only
this half is built — until the guards land, the confirmation dialog naming the
consequence is what stands between somebody and removing their only passkey.

## Alternatives considered

**Recovery by emailed link only, with no password ever.** Cleanest story, and
rejected because it makes "forgot password" a lie that must be made to refuse
loudly instead, and because losing every device with no password is then
unrecoverable without support.

**Reusing `changePassword` with an optional current password.** One endpoint,
and rejected: the refusal in part 2 is the security property, and an endpoint
whose proof requirement depends on the state of the row it is about to write is
one refactor away from not having it.
