# See dev/docs/adr/125-access-reviews-are-an-engine-query.md, the
# "as-of question, answered honestly" section — gap 3, which this closes.
# Aggregates and command lanes: dev/docs/adr/110-grant-aggregates-are-grants.md
# The epoch this has to move: specs/rbac/authz-epoch-cache.feature
#
# What was wrong. Group membership was a row with two columns and a
# createdAt, and removing somebody DELETED it. Since a permission check
# unions what a person holds with what their groups hold, a question asked
# after a removal - "who could see this project in June" - answered as though
# they had never been in the group at all. Not incomplete: wrong, and wrong in
# the direction that understates the access somebody really had. That is the
# worst direction an audit answer can be wrong in, and it is the reason
# point-in-time access reviews could not be built.
#
# What is true now. A membership begins and ends, both are events on the
# authorization log, and ending one marks the record rather than erasing it -
# the same posture a revoked grant has had since the grants ledger landed.

@authz @grants @groups
Feature: Group membership is event truth
  As a LangWatch customer answering an auditor
  I want somebody's membership of a group to have a beginning and an end that
  both survive, and taking them out of a group to take their access with it
  the moment I do it
  So that "who could reach this, and when did that stop" is a question the
  platform can answer rather than one I have to reconstruct

  # Vocabulary, used exactly:
  #   membership   one person's belonging to one group, with its own id
  #   live         a membership that has not ended - the only kind that grants
  #   ended        a membership that was removed; the record of it remains
  #   change history  the authorization audit trail a customer can read

  Background:
    Given an organization "acme"
    And a group "sec-eng" in "acme"
    And a group grant letting "sec-eng" view traces in project "chatbot"
    And user "dave" is a member of "acme"
    And "dave" is in "sec-eng"

  # ═══ Removal takes the access away ════════════════════════════════════

  @integration
  Scenario: Removing someone from a group takes their access away immediately
    When an administrator removes "dave" from "sec-eng"
    Then "dave" can no longer view traces in "chatbot"
    And the answer does not wait for the change to be processed

  @unit
  Scenario: A membership that ended grants nothing anywhere it is read
    Given "dave" was removed from "sec-eng"
    When every place the platform reads who is in a group is asked about "dave"
    Then none of them says he is in "sec-eng"
    And a reader that forgot to ask cannot be written

  @unit
  Scenario: The removal moves the organization's change counter
    When an administrator removes "dave" from "sec-eng"
    Then "acme" has a new change counter
    And no answer held from before the removal is used again

  # ═══ The record survives ══════════════════════════════════════════════

  @integration
  Scenario: The record still shows they were in it and when they left
    When an administrator removes "dave" from "sec-eng"
    Then the platform still holds that "dave" was in "sec-eng"
    And it holds when that membership ended
    And it holds why

  @unit
  Scenario: The first removal is the one that counts
    Given "dave" was removed from "sec-eng" on Tuesday
    When the same removal is stated again on Friday
    Then the membership still ended on Tuesday
    And when access ended is not moved by repeating the instruction

  # ═══ Re-adding ════════════════════════════════════════════════════════

  @integration
  Scenario: Re-adding works and reads as a new membership
    Given "dave" was removed from "sec-eng"
    When an administrator adds "dave" back to "sec-eng"
    Then "dave" can view traces in "chatbot" again
    And the platform holds two memberships for him: the one that ended and the
    one that is live
    And the one that ended still says when it did

  @unit
  Scenario: Somebody already in a group cannot be added to it twice
    When an administrator adds "dave" to "sec-eng"
    Then they are told he is already in it
    And nothing about his membership changes

  @unit
  Scenario: Somebody who is not in a group cannot be taken out of it
    Given "dave" was removed from "sec-eng"
    When an administrator removes "dave" from "sec-eng" again
    Then they are told he is not in it
    And they are not told the group does not exist

  # ═══ Ordering ═════════════════════════════════════════════════════════
  # Every change to one person's membership of one group is queued behind the
  # last one. Without that, a re-add can overtake the removal it follows and
  # be dropped - the person stays out of the group they were just put back
  # into, and nothing reports it.

  @unit
  Scenario: Joining and leaving one group are queued behind each other
    When "dave" is added to "sec-eng", removed, and added back
    Then all three changes queue behind each other in the order they were made
    And a change to somebody else's membership never waits behind them

  # ═══ Deleting a group ═════════════════════════════════════════════════

  @integration
  Scenario: Deleting a group ends its memberships without erasing that they existed
    When an administrator deletes "sec-eng"
    Then every membership of it ends before the group does
    And the change history still names who was in it and when they left

  # ═══ The change history ═══════════════════════════════════════════════

  @integration
  Scenario: The change appears in the authz change history
    When an administrator removes "dave" from "sec-eng"
    Then the change history for "acme" records it
    And the entry names the person, the group and who made the change
    And it is filed under "acme" rather than under the membership it describes

  @unit
  Scenario: A directory removing somebody is still a change somebody made
    Given "sec-eng" is provisioned by an identity provider
    When the directory takes "dave" out of "sec-eng"
    Then the change history records it
    And it names the identity provider as the one that made it

  # ═══ Replay ═══════════════════════════════════════════════════════════

  @unit
  Scenario: Restating a membership cannot un-end it
    Given "dave" was removed from "sec-eng"
    When the platform re-processes the change that put him in it
    Then the membership is still ended
    And he still cannot view traces in "chatbot"

  @unit
  Scenario: Every authorization change made before this existed replays unchanged
    Given an authorization change recorded before memberships were on the log
    When the platform re-processes it
    Then it produces exactly what it produced before
