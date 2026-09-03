# ADR-121: An organization can require the strong factor

**Date:** 2026-08-25

**Status:** Proposed — Wave 3, not built here

**Program:** Identity platform redesign — epic `../identity-platform-redesign.md`,
plan `../identity-platform/delivery-plan.md`, deliverables `D06-mfa-and-session-shape.md`
(the membership-condition machinery this reuses) and `D07-passkeys.md` (which
deferred exactly this).

**Builds on:** ADR-117 (`amr` on the session records what a sign-in proved),
ADR-120 (adoption — an organization cannot require what nobody has).

## Context

D06 gives an organization `mfaRequired`: a membership condition meaning "every
member of this organization can prove a second factor", satisfied three ways —
an enrollment on the account, a passkey, or a provider that asserted a factor.
D07 settled that a passkey satisfies it, because a passkey is possession-based
_and_ phishing-resistant, which is strictly stronger than a typed code against
the attack the requirement exists to stop.

D07 then deferred the refinement, in as many words: _"an org-level
'hardware-bound keys only' refinement… Build it when somebody asks."_

Somebody has asked. This ADR records the shape so it is not re-derived, and
states plainly that it is **not built in the front-door work** — it needs the
authz registry permissions D05 introduces, and it needs the adoption work of
ADR-120 in front of it.

## Decision

**An organization may require a phishing-resistant factor, and the requirement
is read off what the session proved rather than off what the account holds.**

### The condition is `amr`, not an enrollment count

`mfaRequired` asks a question about the account ("can this person prove a
factor"). This one asks about the **sign-in** ("was this session opened with a
phishing-resistant credential"), because that is the property being bought. A
member who holds a passkey and signed in with a password has not been phished
today, but they could be tomorrow, and the requirement exists to make that
impossible rather than unlikely.

So the check reads `amr` for `phw`. A session without it is held at the gate,
and the way through is to sign in again with the passkey — not to enroll
something.

This is the one place this ADR knowingly diverges from D06's shape, and the
divergence is the reason it is a separate decision rather than a flag on the
existing one.

### Two levels, not a boolean

- **`mfaRequired`** — unchanged. Any second factor, satisfied three ways.
- **`phishingResistantRequired`** — stricter. Only `phw` satisfies it; a TOTP
  enrollment does not, and an identity provider satisfies it only where the
  connection asserts a phishing-resistant factor.

The second implies the first. An organization setting it has said something
specific, and collapsing them into one setting with a mode would make the
weaker meaning unsayable.

### Visibility is half the feature

An admin turning this on must first be able to see who it will lock out. The
org-admin surface shows, per member: which credentials they hold, whether their
last sign-in was phishing-resistant, and — before the switch is thrown — the
count of members who would be held at the gate. Turning it on **ends no
session** (D06's rule, kept): it opens a gate, and the people behind it are
told exactly what to do.

### Enterprise-gated

Both the setting and its visibility sit behind the enterprise licence, with the
rest of the org-policy surface.

## Consequences

**Adoption has to come first, and this ADR is downstream of ADR-120.** An
organization that turns this on before its members hold passkeys locks out its
own staff. The pre-flight count is what makes that visible; the nudge is what
makes it survivable.

**A synced passkey satisfies it.** D07 already reasoned this through: a passkey
synced across a person's devices is genuinely weaker than a hardware-bound one,
and still at least as strong as a typed code. `backedUp` comes off the ceremony
and is on the record, so a third, stricter level remains buildable — and stays
unbuilt until somebody asks, on the same principle that produced this one.

**A provider that asserts nothing satisfies nothing.** Same rule as D06, and it
is the SSO hole closed explicitly: a session whose `amr` carries no
phishing-resistant factor is held, and nothing infers one that was not
asserted.

**Recovery must not become the way around it.** An account that can set a
password (ADR-119) and then sign in with it would hold a member out of the very
organization the password was set to rescue them into. That is correct
behaviour and needs to read as such: the gate names the passkey as the way
through, not the password.

## Open questions

- **Whether the impersonation rule follows.** D06 requires an operator's own
  account to have MFA when the subject's org requires it; the analogous rule
  here would require the operator's _session_ to be phishing-resistant. Likely
  yes, and it belongs with D06's impersonation rewrite rather than here.
- **Whether the gate is per-organization or per-resource.** D06's is a
  membership condition evaluated on the way into an organization's data. This
  inherits that unless something argues otherwise.
