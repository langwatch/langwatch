Feature: Claiming with a passkey, scanned from the terminal
  As a developer whose agent just provisioned a temporary account
  I want to scan a QR from my terminal and keep the account with Face ID
  So that claiming needs no password, no email, and no browser on the machine
  I am working on.

  The terminal prints a QR; the phone opens the claim page and does the
  WebAuthn ceremony there. That split is deliberate rather than a limitation
  we worked around: WebAuthn's phishing resistance comes from the *client*
  binding the origin into `clientDataJSON`, and only a browser can be trusted
  to do that honestly. A CLI acting as its own client asserts whatever origin
  it likes, and the server cannot tell that apart from a lie — so a
  terminal-driven passkey would be strictly weaker than the browser one, which
  is the opposite of the point.

  A USB security key over CTAP2 *is* reachable from a terminal (it is how
  `ssh-keygen -t ed25519-sk` works) and may arrive later as a convenience. It
  is not the security story.

  Pairs with:
    - specs/ai-governance/agent-onboarding/claim-handoff.feature
    - specs/ai-governance/agent-onboarding/provisioning.feature

  Background:
    Given an unclaimed account provisioned by `npx langwatch claude`
    And the CLI has started a handoff and printed its QR

  # ─────────────────────────────────────────────────────────────────────
  # Enrolling
  # ─────────────────────────────────────────────────────────────────────

  @bdd @claim @passkey @unit
  Scenario: the phone is offered registration options for the account
    When the phone opens the claim page and asks to create a passkey
    Then it receives WebAuthn registration options
    And the options carry the same short code the terminal is showing
    # so the human can compare the two before touching the sensor.

  @bdd @claim @passkey @unit
  Scenario: the credential is enrolled against the account's own owner
    When the phone completes the ceremony
    Then the credential is stored against the placeholder user that owns the organization
    # which is why nothing has to change hands when the claim settles.

  @bdd @claim @passkey @unit
  Scenario: enrolling claims the account in the same step
    When the phone completes the ceremony
    Then the account is claimed
    And ownership is promoted in place rather than transferred
    And both deadlines are cleared
    # the human is standing right there having just proved possession of the
    # code; a second, separate claim step would be ceremony for its own sake.

  @bdd @claim @passkey @unit
  Scenario: the waiting CLI settles once the phone is done
    Given the phone has completed the ceremony
    When the CLI polls the handoff
    Then it is told the account is claimed

  # ─────────────────────────────────────────────────────────────────────
  # Refusals
  # ─────────────────────────────────────────────────────────────────────

  @bdd @claim @passkey @security @unit
  Scenario: an attestation that does not verify is refused
    When the phone submits an attestation that fails verification
    Then the response is a handled error
    And no credential is stored

  @bdd @claim @passkey @security @unit
  Scenario: a failed ceremony leaves the account claimable
    When an attestation fails verification
    Then the account is still unclaimed
    And its deadlines still stand
    # a botched or hostile attempt must not burn somebody's account.

  @bdd @claim @passkey @security @unit
  Scenario: the challenge cannot be supplied by the caller
    When verification is attempted with no preceding options call
    Then the response is a handled error
    # the challenge is issued by us and parked on the handoff; accepting one
    # from the request body would make the whole ceremony decorative.

  @bdd @claim @passkey @unit
  Scenario: an already-claimed account refuses further enrolment
    Given the account has been claimed
    When the phone asks to create another passkey through the same handoff
    Then the response is a handled error

  @bdd @claim @passkey @security @unit
  Scenario: an expired handoff refuses enrolment
    Given the handoff has outlived its window
    When the phone asks to create a passkey
    Then the response is a handled error
    # the QR is a 15-minute round-trip, not a standing invitation — it may
    # have been photographed, pasted into chat, or left on a shared screen.

  # ─────────────────────────────────────────────────────────────────────
  # What the passkey is worth afterwards
  # ─────────────────────────────────────────────────────────────────────

  # @unimplemented: passkey sign-in needs a session-minting path; better-auth 1.6.23 ships no passkey plugin
  @bdd @claim @passkey @integration @unimplemented
  Scenario: the passkey becomes the way back into the account
    Given the account was claimed by enrolling a passkey
    When the owner later signs in with that passkey
    Then they reach the account without a password or an email

  # @unimplemented: the credential shape is stored; the sign-in counter check comes with sign-in
  @bdd @claim @passkey @security @integration @unimplemented
  Scenario: a cloned authenticator is detected by its signature counter
    Given a credential whose counter goes backwards
    When it is presented at sign-in
    Then the sign-in is refused
