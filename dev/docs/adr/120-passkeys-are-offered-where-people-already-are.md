# ADR-120: Passkeys are offered where people already are

**Date:** 2026-08-25

**Status:** Proposed

**Program:** Identity platform redesign — epic `../identity-platform-redesign.md`,
plan `../identity-platform/delivery-plan.md`, deliverable `D07-passkeys.md`.
Specs: `specs/identity/passkeys.feature`.

**Builds on:** ADR-117 (the auth screens and its method rail), ADR-119 (an
account always has a second way in).

## Context

D07 shipped the capability: passkeys can be created, used, and managed. What it
did not settle is **adoption**, and adoption is the entire value. A passkey
nobody has is a phishing-resistant credential nobody is protected by, and the
research the Passkey Central guidance rests on says the reason is mundane —
most people who have a passkey do not remember making one, and most people who
do not have one have never been asked at a moment they cared.

The product had three symptoms of exactly that:

- The address field on the sign-in screen carried
  `autocomplete="username webauthn"` and had done for as long as passkeys
  existed here. That token does **nothing on its own**: it tells the browser a
  passkey *may* be offered there, and the browser only offers one while a
  conditional-mediation request is actually pending. Nothing ever opened one.
  The field was advertising a capability it did not have.
- The only way in with a passkey was a button on the method rail — findable by
  somebody who already knows they have one, which is the population that needs
  help least.
- Nothing ever suggested making one. Enrolment existed in settings, which is a
  page people visit when something is already wrong.

## Decision

**Offer a passkey at the three moments somebody is already thinking about
signing in, and nowhere else.**

### 1. From the address field itself (conditional mediation)

`usePasskeyAutofill` opens a conditional WebAuthn request for as long as the
sign-in screen lives, so a held passkey appears in the browser's own autofill
list under the field somebody is already looking at. This is the primary route,
ahead of any button, because it is found without being looked for.

It is an **offer, not an attempt**, and behaves like one:

- it asks `isConditionalMediationAvailable()` first — a browser without it is
  left alone rather than shown a modal prompt nobody asked for, which is what a
  plain `get()` would do;
- it never reports failure, because nobody started it;
- it resolves only when somebody picks a passkey, which is why there is no
  loading state anywhere near it.

The button stays, as the fallback the guidance says it should be.

### 2. On the sign-up credential step, beside the password

The step that creates the account takes a passkey **or** a password, with the
passkey above the fields. Beside them rather than in front of them: declining
has to cost nothing, and here it costs a glance, because the other way to
finish is already drawn on the same card.

This is where adoption is cheapest — the person has no habit to change yet.

### 3. A nudge after signing in, once, dismissible

Somebody who signs in without a passkey is offered one immediately afterwards,
as a full step with a plain "Not now", and asked again no sooner than 30 days.

Three properties make this a nudge rather than a nag: it is **once**, it is
**dismissible without penalty**, and it is **after** the sign-in rather than
inside it — nobody is held out of the product to answer it.

## Consequences

**The interstitial is a real cost, and it is the point.** A step between
somebody and what they came for is the most expensive surface in the product,
and it is chosen deliberately: a banner in the app shell costs nothing and
converts accordingly. If the dismissal rate says otherwise, the answer is to
change the interval or the trigger, not to move it somewhere nobody looks.

**"Once, then 30 days" needs somewhere to write it down.** Per-browser storage
is the cheap answer and the wrong one — it forgets on a new device, which is
precisely where the nudge should be *more* eager, and it makes the interval
unenforceable. It belongs on the account.

**Nudging the wrong people is the failure mode to watch.** Somebody who already
holds a passkey and signed in with a password has a good reason (they are on a
machine that does not hold it), and asking them to make another is noise. The
trigger is therefore "holds none", not "did not use one".

**SSO users are out of scope for the nudge.** An organization that federates
has made the credential decision centrally, and a nudge that adds a local
credential beside it undercuts that. Org-level enforcement (ADR-121) is where
that conversation belongs.

## Alternatives considered

**Nudge on every sign-in until accepted.** Higher conversion, and rejected: it
converts by exhaustion, and it teaches people to dismiss whatever the product
puts in front of them, which is a cost paid by every later thing that matters.

**Only after a password sign-in.** Precisely targeted and tempting. Rejected as
the sole trigger because it misses the social/OIDC user who has no passkey
either — but it is the right *priority* if the nudge ever needs rationing.

**No nudge; rely on autofill and the sign-up step.** The honest minimum, and
what ships first. The nudge is the part that reaches the existing population,
which is the population that has an account worth protecting.
