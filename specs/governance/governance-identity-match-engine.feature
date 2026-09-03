@governance @identity
Feature: Deciding which provider-named person is which LangWatch account
  Providers put names on the rows we pull, and almost none of those names are
  LangWatch accounts. Working out who is who has exactly two honest answers:
  either something proves it, in which case nobody should have to click, or
  nothing does, in which case a person decides and the machine keeps its guess
  to itself. The dangerous middle — a confident guess — is what routes one
  person's spend to another person's name and never tells anyone.
  Decision: ADR-128 section 12.

  Background:
    Given an organization whose providers name people on the rows we pull

  # ── Proof links by itself ─────────────────────────────────────────────────

  @unit
  Scenario: An address that matches a confirmed account links without anybody clicking
    Given a provider-named person whose identifier is an email address
    And an account in the organization that has confirmed that same address
    When the matcher runs
    Then the person is linked to that account
    And the link records that a confirmed address is what proved it

  @unit
  Scenario: An address nobody has confirmed proves nothing
    Given a provider-named person whose identifier is an email address
    And an account holding that address which has never confirmed it
    When the matcher runs
    Then the person is not linked
    # An unconfirmed address is a claim, not evidence. Anyone can type one in.

  @unit
  Scenario: A directory identifier on its own never links anybody
    Given a provider-named person whose identifier is a directory identifier
    And an account carrying that same directory identifier
    When the matcher runs
    Then the person is not linked
    # Directory identifiers exist only for people the identity provider created,
    # they are refreshed daily, and the provider itself advises against building
    # on them. They strengthen a match; they cannot make one.

  @unit
  Scenario: A directory identifier agreeing with the address is recorded as the stronger proof
    Given a provider-named person whose address matches a confirmed account
    And the same account carries the directory identifier the provider sent
    When the matcher runs
    Then the person is linked to that account
    And the link records that the directory agreed as well

  @unit
  Scenario: Somebody who is not a person is never linked to an account
    Given a provider-named actor that is a machine login
    And an account whose confirmed address is the same string
    When the matcher runs
    Then it is not linked
    # Machine logins are their own kind. Filing one under an employee's name
    # would put plumbing traffic in that employee's spend.

  # ── Two candidates stop the machine ───────────────────────────────────────

  @unit
  Scenario: An address that two accounts both confirmed stops automatic linking
    Given a provider-named person whose address two accounts have both confirmed
    When the matcher runs
    Then the person is not linked
    And automatic linking is halted for that person
    And the halt says two accounts claimed the same address

  @unit
  Scenario: A directory identifier naming a different account than the address stops automatic linking
    Given a provider-named person whose address matches one account
    And whose directory identifier belongs to a different account
    When the matcher runs
    Then the person is not linked
    And automatic linking is halted for that person

  @unit
  Scenario: A halt survives the next run of the matcher
    Given a person whose automatic linking was halted
    When the matcher runs again
    Then the person is still not linked
    And the halt is left exactly as it was
    # A halt a recompute clears is not a halt. It lives on the person, not in
    # the job's output.

  @unit
  Scenario: A person who is already linked is left alone
    Given a provider-named person with an open link to an account
    When the matcher runs
    Then no second link is opened

  @unit
  Scenario: An erased person is never linked to an account again
    Given a person who has been erased
    When the matcher runs
    Then they are not linked
    # Their identifier is a stand-in now. Re-linking them would attach an
    # account to the very row the erasure just detached one from.

  # ── A guess only ever suggests ────────────────────────────────────────────

  @unit
  Scenario: A name that merely resembles an account becomes a suggestion, never a link
    Given a provider-named person whose display text resembles an account holder's name
    When the suggestion job runs
    Then no link is opened
    And a suggestion is stored for a person to confirm

  @unit
  Scenario: Two names sharing no word are never scored against each other
    Given a provider-named person and an account holder sharing no word in their names
    When the suggestion job runs
    Then the pair is discarded before any comparison is made
    # Comparing every person against every account is the quadratic cost this
    # whole design exists to keep off a page load.

  @unit
  Scenario: Names of wildly different length are never scored against each other
    Given a provider-named person whose name is far longer than an account holder's
    When the suggestion job runs
    Then the pair is discarded before any comparison is made

  # Providers hand us an address where a name belongs, and so does our own
  # account table when a member never set a display name. Comparing the whole
  # string breaks the pass in both directions at once: an address against a name
  # is rejected by the length band so nothing is ever suggested, and an address
  # against an address shares the company domain so everything is.
  @unit
  Scenario: An address is compared by the part that names the person
    Given a provider-named person whose display text is a mail address
    And an account holder whose display name is the same person's name
    When the suggestion job runs
    Then the two are compared by the part of the address that names the person
    And a suggestion is stored for a person to confirm

  @unit
  Scenario: Two addresses on one company domain are not alike for sharing it
    Given two people whose display texts are addresses on the same company domain
    And their names have no word in common
    When the suggestion job runs
    Then the pair is discarded before any comparison is made

  @unit
  Scenario: A weak resemblance is not worth showing anybody
    Given a provider-named person whose name barely resembles an account holder's
    When the suggestion job runs
    Then no suggestion is stored

  @unit
  Scenario: A person whose automatic linking is halted gets no suggestions either
    Given a person whose automatic linking was halted
    When the suggestion job runs
    Then no suggestion is stored for them
    # The halt is there because the evidence is contradictory. Adding guesses on
    # top of contradictory evidence is not help.

  @integration
  Scenario: Running the suggestion job again replaces what it found last time
    Given stored suggestions from an earlier run
    When the inputs change and the job runs again
    Then the suggestions match what the new inputs imply
    And the ones the old inputs implied are gone

  @unit
  Scenario: Nothing that answers a request ever compares two names
    When every path that serves a request is followed
    Then the name comparison is reachable only from the background job
    # It measured 2.9 seconds of blocked event loop at this document's own
    # example size, on every page load, uncached.

  # ── A person confirms ─────────────────────────────────────────────────────

  @integration
  Scenario: Confirming a suggestion opens the link and clears the suggestion
    Given a stored suggestion for a person
    When somebody confirms it
    Then a link to that account is opened
    And the link records that a person confirmed it
    And the suggestion is gone

  @integration
  Scenario: Confirming a suggestion for somebody since linked is refused
    Given a stored suggestion for a person who has since been linked
    When somebody confirms it
    Then the confirmation is refused
    And the refusal says the person already holds a link

  @unit
  Scenario: Confirming a suggestion that no longer exists is refused
    Given a suggestion that has already been confirmed
    When somebody confirms it again
    Then the confirmation is refused

  # An erased person is never linked to an account again, and a review queue is
  # read by people, so the two halves below are one rule. Erasure takes the
  # invitation away; the refusal covers the queue already on somebody's screen.

  @integration
  Scenario: Erasing a person clears the match suggestions naming them
    Given a person with a pending match suggestion
    When the person is erased
    Then no suggestion names that person any more

  @unit @integration
  Scenario: Confirming a suggestion for an erased person is refused
    Given a stored suggestion for a person who has since been erased
    When somebody confirms it
    Then the confirmation is refused
    And the refusal says the person has been erased
    And no link to that account is opened

  # The automatic half of the same rule. The pass reads the whole organization
  # once and then writes its way through it, so an erasure that finishes in the
  # middle leaves a pass holding a list that says the person is still live.
  # The database only half-helps: erasure blanks a person's links rather than
  # removing them, so someone who HAD a link still holds their one-open-link
  # slot and a fresh link is refused — but a person who never had a link has
  # nothing in the database to refuse the row. The re-check below is the only
  # guard that covers everyone.

  @unit
  Scenario: A person erased while a match pass is running is not linked
    Given a match pass that read a person before they were erased
    When the pass reaches the point of opening their link
    And the person has been erased in the meantime
    Then no link is opened
    And the rest of the organization is still matched

  @unit @integration
  Scenario: A link opened during an erasure is blanked before the erasure returns
    Given an erasure that has already detached a person's accounts
    When a match pass opens a link on that person before the erasure finishes
    Then the erasure blanks that link too
    And the count it reports includes it
