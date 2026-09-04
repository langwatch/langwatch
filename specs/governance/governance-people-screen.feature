@governance @identity
Feature: The People screen shows who the providers named
  Departments already live on this screen. This adds the people themselves:
  everyone a provider has named, whether they hold a LangWatch account or
  not, with the match engine's verdicts beside them and its button in front
  of them. The engine keeps no standing appointment
  (governance-identity-match-engine.feature) — this screen asks for the proof
  pass on demand, and the feed that discovers people triggers the rest.
  Decision: ADR-128 sections 11 and 12.

  Background:
    Given an organization with discovered people

  # ── Reading ───────────────────────────────────────────────────────────────

  @integration
  Scenario: The list shows what a provider said and what the engine decided
    When a governance viewer opens the People screen
    Then each discovered person shows their identifier, provider, and kind
    And when they were first and last seen
    And whether they are linked to an account, and by what proof

  @integration
  Scenario: A linked person shows their member's department
    Given a discovered person linked to a member assigned to a department
    When the list is read
    Then that person's row carries the department name
    # The department lives on the membership, not on the discovered person.
    # The row shows it through the link; an unlinked person shows none.

  @integration
  Scenario: An erased person shows a stand-in, never the identifier
    Given a person who has been erased
    When the list is read
    Then their row is marked erased
    And shows the pseudonym their identifier was replaced with
    # The row survives erasure so spend stays attributable to someone; what
    # it must never do is show who that someone was.

  @integration
  Scenario: Reading the list requires the governance view grant
    When someone without governance view asks for the list
    Then the request is refused

  # ── Running the engine ────────────────────────────────────────────────────

  @integration
  Scenario: The match button runs the proof pass
    When a governance manager presses the match button
    Then proven identities are linked
    And the answer says how many were linked and how many remain unproven
    # Proof only, and the absence is the design: the suggestion pass scores
    # names, which the engine's import-graph gate keeps off every request
    # path (ADR-128 section 12). The button gives fresh proof links on
    # demand; guesses arrive with the feed, below.

  @unit
  Scenario: Suggestions are recomputed when the feed discovers people
    When a pull delivers rows that discover at least one person
    Then the suggestion pass runs on the worker, after the delivery's own writes
    # The trigger the engine spec promised: a call site on the feed, composed
    # by the root on the worker role. A pull that discovers nobody is not a
    # trigger — an empty feed re-scoring an unchanged queue is the nightly
    # timer this design replaced.

  @integration
  Scenario: Running the engine requires the governance manage grant
    When someone with only governance view asks to run the engine
    Then the request is refused
    # The viewer grant reads; linking writes identity rows.

  # ── Suggestions ───────────────────────────────────────────────────────────
  # What confirming does — the link it opens, the refusals for people since
  # linked or erased — is the engine spec's contract. This screen only has
  # to reach it.

  @integration
  Scenario: A suggestion shows both halves and a confirm action
    Given a stored suggestion
    When a governance manager reads the screen
    Then the suggestion shows the provider-named person and the account
    And confirming it links them and removes the suggestion from the screen

  @integration
  Scenario: Confirming requires the governance manage grant
    When someone with only governance view tries to confirm a suggestion
    Then the request is refused
