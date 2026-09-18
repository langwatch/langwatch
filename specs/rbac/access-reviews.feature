# See dev/docs/adr/125-access-reviews-are-an-engine-query.md, and the ADR-092
# entry it implements ("What falls out for free" — Access reviews / SOC 2
# evidence). The proof shape it generalises is ADR-092 section 10, already live
# for offboarding; the dates it reports are the grant lifecycle of
# specs/rbac/authz-grants.feature and specs/rbac/expiring-grants.feature.
#
# WHY THIS SPEC IS IN specs/rbac.
# The review's question is the engine's question asked backwards — not "may
# this principal do this here" but "which principals may do this here". It is
# engine vocabulary, so it sits with the other ADR-092 free-list specs
# (authz-epoch-cache, expiring-grants, denial-explanations, agent-principals).
# It is NOT an audit-log spec: the audit trail is one of its inputs and keeps
# its own contract.
#
# Vocabulary, used exactly:
#   review      one organization, captured at one instant, by one person.
#   bundle      what a review produces: the evidence a reviewer reads and an
#               auditor keeps.
#   reach       what a principal can actually do at a scope, however they got
#               it — not the rows bound at that scope.
#   path        how a reach was arrived at: directly, through a group, through
#               a key whose owner sets its ceiling, or through a share link.
#   change      one access fact that was attached, re-roled, revoked, or a role
#               that was defined, edited or deleted.
#
# WHAT THIS SPEC DOES NOT COVER, deliberately (ADR-125 section 8):
#   - Asking who could reach something on a PAST date. The facts needed to
#     answer that do not exist: group membership keeps no history at all, and a
#     grant's role and a role's permissions are both rewritten in place. An
#     as-of answer today would UNDERSTATE past access, and a scenario asserting
#     one would be a scenario asserting a wrong answer.
#   - Assigning, approving or signing off a review. That is process tooling.
#     The bundle is built to be read and imported by it, not to replace it.
#   - Classifying which data is personal. "Who can see PII in this project"
#     is asked and answered as "who holds the permissions that reach this
#     project's data".
#
# EVERY SCENARIO IS @unimplemented, and for one reason: none of this is built.
# The engine can answer for one principal at one scope today, but only for the
# caller themselves (routers/authz.ts), the Access surface lists rows bound AT
# a scope rather than everything that REACHES it, and no export, no bundle and
# no review record exist at all. The tags carry no level (@unit / @integration)
# on purpose: the seam that should bind each of these does not exist yet, and
# guessing its level now would be a decision made in the wrong place. Matches
# the treatment of the unshipped stages in unified-authorization-engine.feature
# and agent-principals.feature.

@authz @rbac @grants
Feature: Access reviews
  As someone answerable for who can reach what in our account
  I want to ask the product who can reach a thing, and to take away an
  artefact that says so completely and says how it knows
  So that a quarterly access review is a question I ask rather than a
  spreadsheet I assemble, and so an auditor gets evidence instead of a claim

  Background:
    Given an organization "acme" with projects "chatbot" and "billing"
    And an administrator "olivia" of "acme"
    And a member "alice" with access to "chatbot" granted to her directly
    And a group "sec-eng" with access to "chatbot", which "bruno" belongs to
    And an API key "reporting-key" with access to "chatbot", owned by "carla"
    And a public link to a trace in "chatbot", published by "alice"

  # ═══ Asking who can reach a thing ═════════════════════════════════════

  @unimplemented
  Scenario: Every way in is named, not just the ones bound at the project
    When olivia asks who can reach "chatbot"
    Then alice is listed, because she was given access to it directly
    And bruno is listed, because he is in "sec-eng"
    And "reporting-key" is listed, with carla named as the person whose access
      limits it
    And the published link is listed as a way into the trace it was published
      for
    And nobody appears without the answer saying how they got there

  @unimplemented
  Scenario: Access granted higher up the account reaches the project
    Given a contractor "dev" was given access across the whole of "acme"
    When olivia asks who can reach "chatbot"
    Then dev is listed
    And the answer says the access was given across the whole organization,
      not on "chatbot"

  @unimplemented
  Scenario: A key can never be listed as reaching more than its owner
    Given "reporting-key" was given more access to "chatbot" than carla holds
    When olivia asks who can reach "chatbot"
    Then the key is listed with only what carla can do there
    And the answer says carla's access is what limits it

  @unimplemented
  Scenario: Demoting the owner shrinks the key in the next answer
    Given olivia reduces carla to read-only on "chatbot"
    When olivia asks again who can reach "chatbot"
    Then "reporting-key" is listed as read-only
    And nothing had to be rotated or re-granted for that to be true

  @unimplemented
  Scenario: Asking who can reach the data rather than who is bound to it
    When olivia asks who can read the traces in "chatbot"
    Then everyone who can read them is listed, however they got the access
    And the answer says it is naming people who hold that access, not people
      who have looked
    And it does not claim to know which of those traces hold personal data

  @unimplemented
  Scenario: Someone with no way in is absent rather than listed as denied
    Given "dana" is a member of "acme" with no access to "chatbot"
    When olivia asks who can reach "chatbot"
    Then dana is not listed
    And the list is of people who can reach it, not of everybody with an answer

  # ═══ The export ═══════════════════════════════════════════════════════

  @unimplemented
  Scenario: A review names every principal that could hold anything
    When olivia exports a review of "acme"
    Then every member is named, including any whose membership is disabled
    And every group is named, with who belongs to it
    And every API key is named, with the person whose access limits it
    And a key that nobody owns is named and flagged as limited by nobody

  @unimplemented
  Scenario: A review says what each role name means
    Given alice's access to "chatbot" was given through a role somebody wrote
    When olivia exports a review of "acme"
    Then the role is listed with everything it permits
    And a reader who has never seen that role can tell what alice can do
    And the review records which version of the account's role vocabulary it
      was read against

  @unimplemented
  Scenario: A review says when each access began and when it ends
    Given bruno's access to "billing" was given until the end of next month
    When olivia exports a review of "acme"
    Then bruno's access to "billing" shows the day it began
    And it shows the day it ends
    And alice's access, which nobody put an end date on, shows that it stands
      until somebody takes it away

  @unimplemented
  Scenario: Access that has already elapsed is shown, not hidden
    Given a contractor's access to "chatbot" ran out last week
    When olivia exports a review of "acme"
    Then that access is listed with the day it ran out
    And it is not shown as access somebody revoked
    And olivia can see it is still there to be cleaned up

  @unimplemented
  Scenario: A published link is evidence without being usable
    When olivia exports a review of "acme"
    Then the published link appears, with who published it, what it opens,
      what it permits, when it stops working and how much of its view
      allowance is left
    And nothing in the review can be used to open it
    And olivia has what she needs to withdraw it

  @unimplemented
  Scenario: Nothing anywhere in a review can be used as a credential
    When olivia exports a review of "acme"
    Then no part of the review contains anything that would let its reader in
    And that holds for every kind of access the review lists

  @unimplemented
  Scenario: A review says what it deliberately leaves out
    Given several members have assistants working in "chatbot"
    When olivia exports a review of "acme"
    Then the review states that assistant conversations are not access and are
      not listed
    And it states which kinds of change it does not record
    And a reader can tell the difference between something absent on purpose
      and something missing

  # ═══ What changed since last time ═════════════════════════════════════

  @unimplemented
  Scenario: A revoked access appears in the change history with when and why
    Given alice's access to "chatbot" is taken away, with a reason given
    When olivia exports a review of "acme"
    Then the change history records that it was taken away
    And it records when
    And it records the reason that was given
    And it records who did it

  @unimplemented
  Scenario: The change history covers exactly the time since the last review
    Given "acme" was reviewed at the end of last quarter
    And access was granted and taken away several times since
    When olivia exports a review of "acme"
    Then every one of those changes is in the change history
    And nothing from before the last review is
    And the review names the review it is measured from

  @unimplemented
  Scenario: The first review of an account says it is the first
    Given "acme" has never been reviewed
    When olivia exports a review of "acme"
    Then the review says it is the first, so there is nothing to compare with
    And it does not present an empty change history as "nothing changed"

  # A review is measured from the one before it, so "the same period" is not
  # something a second export can ask for — the window has moved on. What an
  # auditor is testing is that the record already taken cannot change, so this
  # reads the review that was exported rather than exporting it again.
  @unimplemented
  Scenario: The change history cannot be rewritten after the fact
    Given a review of "acme" was exported last week
    And access has been granted and taken away since
    When olivia opens that review again
    Then its change history is exactly what it was when it was exported
    And nothing that happened since appears in it

  @unimplemented
  Scenario: A later review leaves the earlier one alone
    Given a review of "acme" was exported last week
    When olivia exports a new review of "acme"
    Then the earlier review's change history is unchanged
    And no change it recorded has been edited or removed

  @unimplemented
  Scenario: A period older than the account keeps its history says so
    Given "acme" keeps its record of changes for a limited time
    And olivia asks for a period reaching further back than that
    When olivia exports a review of "acme"
    Then the review says the period reaches further back than the record does
    And she is not shown a short list that reads as a quiet period

  @unimplemented
  Scenario: Access that arrived when the account was set up has no change to show
    Given some of alice's access predates the account's record of changes
    When olivia exports a review of "acme"
    Then that access is listed as access she holds
    And the review says why it has no matching change
    And it does not read as access that appeared from nowhere

  # ═══ Agreeing with the rest of the product ════════════════════════════

  @unimplemented
  Scenario: Offboarding proof and the review artefact agree
    Given "dave" was offboarded from "acme" and the offboarding proved he
      resolves nothing
    When olivia exports a review of "acme"
    Then dave appears nowhere as being able to reach anything
    And the review lists the access he used to hold, with the day it ended

  @unimplemented
  Scenario: A review that contradicts the offboarding proof is treated as a fault
    Given "dave" was offboarded from "acme"
    When a review would nonetheless list him as able to reach "chatbot"
    Then the disagreement is reported as our defect
    And it is not presented to olivia as something for her to reconcile

  @unimplemented
  Scenario: The review answers with the same engine the product decides with
    Given the review says bruno can read the traces in "chatbot"
    When bruno reads a trace in "chatbot"
    Then he is allowed
    And where the two ever disagree, that is a defect rather than a difference
      of opinion

  # ═══ Who may ask ══════════════════════════════════════════════════════

  @unimplemented
  Scenario: Reviewing the account does not require being able to change it
    Given "priya" may read the record of what happens across "acme" and may
      change nothing
    When priya exports a review of "acme"
    Then she gets the review
    And she is not asked to be made an administrator first

  @unimplemented
  Scenario: An ordinary member cannot review the account
    When alice tries to export a review of "acme"
    Then she is refused
    And the refusal says what she would need

  @unimplemented
  Scenario: Someone who may review one project cannot enumerate the whole account
    Given "sam" may read the record of what happens in "chatbot" and nowhere
      else
    When sam asks who can reach "chatbot"
    Then he gets the answer
    When sam tries to export a review of the whole of "acme"
    Then he is refused
    And he has learned nothing about anyone outside "chatbot"

  # ═══ When it goes wrong ═══════════════════════════════════════════════

  @unimplemented
  Scenario: A large account's review does not have to be waited for
    Given "acme" has thousands of people, groups and keys
    When olivia exports a review of "acme"
    Then she is told the review has been started
    And she is told when it is ready
    And she did not have to keep the page open for it to finish

  @unimplemented
  Scenario: A review that could not be finished is not published as one
    Given a review of "acme" fails partway through
    When olivia looks for it
    Then it is not offered to her to download
    And she is told it failed and can start another
    And the failure is recorded as ours

  @unimplemented
  Scenario: A review says the moment it describes
    When olivia exports a review of "acme"
    Then the review states the instant it was captured
    And access granted after that instant is not presented as having been
      reviewed
