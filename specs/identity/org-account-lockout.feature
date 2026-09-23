# Control: GAC-09.
Feature: An organization can lock accounts after repeated failed sign-ins
  As an organization administrator answerable for how our people sign in
  I want repeated failures to lock the account rather than merely slow it down
  So that a stolen password list cannot be worked through against us, and so
  that the attempt is on the record

  # WHY THIS IS NOT THE RATE LIMITER WE ALREADY HAVE.
  #
  # Sign-in is already rate limited - fifty attempts per fifteen minutes on
  # the password path, and tighter still on password reset. That throttles a
  # PATH. It does not lock an ACCOUNT, and the difference is the whole control:
  # a throttle forgets, applies to whoever is calling rather than to whose
  # account is being tried, and lets an attacker who paces themselves continue
  # indefinitely. A lock is a decision about one account that persists, is
  # visible to an administrator, and ends in an event somebody can alert on.
  # Both stay. The throttle is the ceiling on volume; the lock is the answer to
  # persistence.
  #
  # OFF UNLESS AN ORGANIZATION ASKS. Nothing about existing sign-ins changes
  # until an administrator sets a threshold, which mirrors how every other
  # organization-wide rule on this page behaves. The numbers below - five
  # attempts, thirty minutes - are the ones the control names and the ones the
  # form offers first, not the ones anybody gets by default.
  #
  # STRICTEST ORGANIZATION WINS. A person can belong to several organizations
  # and has one way of signing in, so the lock cannot be per-organization: the
  # tightest threshold among their memberships is the one their sign-ins are
  # counted against. An organization can tighten how its people sign in; it
  # cannot loosen what another organization already requires of them.

  Background:
    Given an organization "acme" whose administrator "ana" may manage it
    And "sam" is a member of "acme"

  Rule: an organization that never configures this locks nobody

    @unit
    Scenario: No threshold means no lock
      Given "acme" has never set a sign-in attempt threshold
      When "sam" gets his password wrong twenty times
      Then he is never locked out
      And he can still sign in with the right password
      # The default, and the reason turning this on is safe to ship: an
      # installation that does nothing behaves exactly as it did.

    @integration
    Scenario: The threshold is offered with the numbers the control asks for
      When "ana" opens the sign-in security card
      Then the attempt threshold is offered starting at five
      And the lock-out period is offered starting at thirty minutes
      And both say plainly that nobody is locked out until she saves them

  Rule: failures are counted against the account, not against the door

    @unit
    Scenario: The counter does not care which credential failed
      Given "acme" locks an account after five failed attempts
      When five attempts against "sam"'s address fail
      Then he is locked out
      # The decision never learns WHICH credential was wrong, and that is
      # deliberate: a counter that could tell them apart is one somebody would
      # eventually give a budget each, which hands an attacker one budget per
      # factor - the opposite of what a second factor is for.

    @unit
    Scenario: The second step keeps the lock it already had
      Given "sam" is signing in and gets his one-time code wrong repeatedly
      Then he is locked out of the second step
      And that lock is not the one this feature counts
      # WHAT IS ACTUALLY WIRED, said plainly rather than implied.
      #
      # This feature counts attempts against an ADDRESS, because the address
      # is what an attacker works through a list of and the only thing a
      # failed attempt reliably carries. The second-step endpoints carry no
      # address at all - a wrong one-time code arrives with a pending
      # ceremony and no session to attribute it to - so they are not counted
      # here.
      #
      # They are not unprotected: the two-step plugin has kept its own
      # per-account counter and its own lock since D06, which is why that
      # deliberately was not rebuilt. The practical effect is that reaching
      # the second step at all costs the password, which this counter is
      # already guarding.
      #
      # The cost of the split is real and worth writing down: somebody who
      # already holds a valid password gets the second step's budget as well
      # as this one, rather than one budget between them. Folding the two
      # together needs the second-step endpoints to name whose ceremony they
      # belong to, which they do not today.

    @unit
    Scenario: Signing in successfully clears the count
      Given "acme" locks an account after five failed attempts
      And "sam" has failed four times
      When he signs in correctly
      Then his failed attempt count is back to zero
      # "Five consecutive", not five ever. Without this the threshold becomes a
      # lifetime budget and every long-lived account eventually trips it.

    @unit
    Scenario: The tightest threshold among a person's organizations applies
      Given "sam" belongs to "acme", which locks after five attempts, and to
      "globex", which locks after ten
      When he fails five times
      Then he is locked out
      # And his personal workspace is locked too, because there is one of him
      # and one way in. Said out loud here so it is a decision rather than a
      # surprise.

  Rule: a locked account says the same thing an unknown one does

    @unit
    Scenario: An address with no account locks exactly as one with an account
      Given "acme" locks an account after five failed attempts
      When somebody fails five times against an address that has no account
      Then that address is locked out
      And they are answered exactly as a locked account answers
      # GIA-02's neighbour, and the trap in this whole control. We already
      # collapse "no such user" and "wrong password" into one answer so that
      # sign-in cannot be used to find out who has an account. A lock-out
      # message shown only for real accounts would put that back: five wrong
      # guesses at alex@example.com saying "locked" and five at nobody@
      # example.com saying "incorrect" tells an attacker which addresses are
      # worth attacking. So the count is kept against the address that was
      # TYPED, and an address with nothing behind it locks just the same.

    @unit
    Scenario: An address nobody holds is bound by the strictest rule on the installation
      Given "acme" locks after five attempts and no other organization locks
      at all
      When somebody fails five times against an address that has no account
      Then the threshold applied is five
      # It cannot be "this address's organizations", because an address with
      # no account belongs to none. The strictest rule anybody on this
      # installation has set stands in, which is what makes the scenario above
      # true rather than aspirational: without it an unknown address would
      # never lock, and never locking is itself the signal.

    @unit
    Scenario: One organization's threshold does not lock another organization's members
      Given "acme" locks after five attempts and "globex" locks after none
      When "gil", a member of "globex" alone, fails five times
      Then he is not locked out
      # The tenant boundary, and it is deliberately stronger than the oracle
      # argument above. What it costs is worth naming plainly: on an
      # installation where at least one organization locks, an address that
      # never locks is thereby known to hold an account under an organization
      # that does not - so the residue of an existence oracle survives, at
      # five attempts a guess, for members of non-locking organizations only.
      #
      # We take that over the alternative, which is letting one customer's
      # setting lock another customer's members out. The primary vector - "is
      # there an account here at all" - is closed, because an unknown address
      # locks exactly like a known one. On an installation where nobody has
      # turned this on, nothing locks and there is no signal of any kind.

    @unit
    Scenario: The answer never says which half was wrong
      Given "sam" is locked out
      When he signs in with his correct password
      Then he is told that too many attempts have been made and when to return
      And he is not told that the password was right
      # Telling him the password was correct turns the lock-out screen into a
      # password oracle - the attacker learns the credential without ever
      # getting in.

  Rule: the lock ends by itself, until it has happened too often

    @unit
    Scenario: The lock lifts when the period is over
      Given "acme" locks accounts for thirty minutes
      And "sam" was locked out thirty-one minutes ago
      When he signs in with the right password
      Then he is signed in
      And his failed attempt count is back to zero

    @unit
    Scenario: A fifth consecutive lock-out stops lifting by itself
      Given "acme" locks accounts after five attempts
      And "sam" has been locked out four times in a row without ever signing in
      between them
      When he is locked out a fifth time
      Then the lock does not lift when the period is over
      And it is recorded as an incident rather than as another lock-out
      # What "a maximum of five consecutive lockouts" means in practice. Four
      # lock-outs is somebody who has forgotten their password; twenty-five
      # failures across five lock-outs is somebody working through a list, and
      # continuing to release the account every half hour just gives them the
      # next window.

    @unit
    Scenario: Proving you own the mailbox clears a held account
      Given "sam" is held after a fifth consecutive lock-out
      When he completes a password reset
      Then the hold is cleared and he can sign in
      # The way out that does not need an administrator, and the reason a held
      # account is not a denial-of-service anyone can inflict by typing a
      # colleague's address wrong five times over. It costs mailbox control,
      # which is exactly what the attacker does not have.

    @integration
    Scenario: An administrator can release a held account
      Given "sam" is held after a fifth consecutive lock-out
      When "ana" releases him from the people list
      Then he can sign in again
      And the release is on his record with her name on it

  Rule: every lock is on the record

    @unit
    Scenario: A lock is an event, not just a log line
      Given "acme" locks accounts after five attempts
      When "sam" is locked out
      Then the lock is recorded against his identity with the count that
      caused it
      # Evidence is half of what this control asks for. A lock that exists only
      # as a row somebody has since overwritten proves nothing to an auditor
      # six months later.

    @unit
    Scenario: The incident is distinguishable from the lock-outs that led to it
      When a fifth consecutive lock-out is reached
      Then a separate escalation is recorded
      And it can be alerted on without alerting on ordinary lock-outs
      # An alert that fires on every lock-out fires constantly and gets muted,
      # which is how the one that mattered is missed.

    @unit
    Scenario: Nothing recorded carries the credential that was tried
      When a failed attempt is recorded
      Then neither the password, the code nor the address's secret is on the
      record
      # A lock-out trail that accumulates the passwords people typed is a
      # worse breach than the one it was built to prevent.

    # The counter is keyed on the address somebody TYPED, so anybody can make
    # rows appear; an hourly sweep clears the finished ones. It releases nothing.
    @unit
    Scenario: Finished lock-out rows are cleared a day after they settle
      Given lock-out rows untouched for more than a day, one held for review and one still locked
      When the hourly sweep runs
      Then only the settled row is removed
      And the held, the still-locked and the recently touched rows remain
