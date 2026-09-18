# The prerequisite this finishes: specs/rbac/group-membership-is-event-truth.feature
# See dev/docs/adr/125-access-reviews-are-an-engine-query.md, the
# "as-of question, answered honestly" section.
# The epoch this has to move: specs/rbac/authz-epoch-cache.feature
#
# What was wrong. Making a membership removal MARK its row bought the record
# of who left a group and when - and then deleting the group threw that record
# away, because the group's deletion took every membership row with it. The
# log still held the facts, but the tables a person can read no longer agreed
# with them, and "who was in sec-eng in June" answered nothing at all once
# sec-eng was gone. A group is usually deleted precisely when somebody wants
# to know what it used to grant.
#
# What is true now. Deleting a group ends its grants and its memberships, each
# one a fact of its own, and then MARKS the group rather than removing it. The
# name is free to be used again; the record of the group that held it is not
# thrown away to free it.

@authz @grants @groups
Feature: Deleting a group keeps its history
  As a LangWatch customer answering an auditor
  I want deleting a group to take its access away at once and still leave
  behind who was in it, what it granted, and when that ended
  So that tidying up an organization never costs me the ability to explain
  what it used to be

  # Vocabulary, used exactly:
  #   live group      a group that has not been deleted - the only kind that
  #                   grants, is listed, or can be edited
  #   deleted group   a group that was deleted; the record of it remains
  #   change history  the authorization audit trail a customer can read

  Background:
    Given an organization "acme"
    And a group "sec-eng" in "acme"
    And a group grant letting "sec-eng" view traces in project "chatbot"
    And user "dave" is a member of "acme"
    And "dave" is in "sec-eng"

  # ═══ The access goes ══════════════════════════════════════════════════

  @integration
  Scenario: Deleting a group takes its access away immediately
    When an administrator deletes "sec-eng"
    Then "dave" can no longer view traces in "chatbot"
    And the answer does not wait for the change to be processed

  @unit
  Scenario: A deleted group grants nothing anywhere it is read
    Given "sec-eng" was deleted
    When every place the platform reads a group is asked about "sec-eng"
    Then none of them treats it as a group that still exists
    And a reader that forgot to ask cannot be written

  @unit
  Scenario: Deleting a group moves the organization's change counter
    When an administrator deletes "sec-eng"
    Then "acme" has a new change counter
    And no answer held from before the deletion is used again

  # ═══ The record survives ══════════════════════════════════════════════

  @integration
  Scenario: The record still shows who was in the group and when it ended
    When an administrator deletes "sec-eng"
    Then the platform still holds that "dave" was in "sec-eng"
    And it holds when that membership ended
    And deleting the group does not take that record with it

  @unit
  Scenario: The first deletion is the one that counts
    Given "sec-eng" was deleted on Tuesday
    When an administrator deletes "sec-eng" again on Friday
    Then they are told it is already deleted
    And they are not told it never existed
    And the group still reads as deleted on Tuesday

  # ═══ Using the name again ═════════════════════════════════════════════

  @integration
  Scenario: A group name can be used again after the group is deleted
    Given "sec-eng" was deleted
    When an administrator creates a group called "sec-eng"
    Then the new group is created under the same name
    And it is a different group from the one that was deleted
    And it grants nothing the deleted one granted

  @integration
  Scenario: Two live groups still cannot share a name
    When an administrator creates a second group called "sec-eng"
    Then they are refused
    And "sec-eng" is unchanged

  @unit
  Scenario: A name freed by a deletion is offered without a suffix
    Given "sec-eng" was deleted
    When an administrator asks for a group called "sec-eng"
    Then the name they are given is "sec-eng"
    And it is not made unique against the group that was deleted

  # ═══ The directory ════════════════════════════════════════════════════

  @integration
  Scenario: A directory group that disappears and returns does not collide
    Given "sec-eng" is provisioned by an identity provider
    And the directory deletes "sec-eng"
    When the directory pushes "sec-eng" again with the same directory id
    Then it is accepted
    And it arrives as a new group with no members and no grants
    And the record of the group it replaced is still held

  @unit
  Scenario: A deleted directory group is gone as far as the directory is concerned
    Given "sec-eng" is provisioned by an identity provider
    And the directory deleted "sec-eng"
    When the directory asks for "sec-eng"
    Then it is told there is no such group
    And the change history still names who was in it

  # ═══ The change history ═══════════════════════════════════════════════
  #
  # That ONE removal earns an audit entry is
  # group-membership-is-event-truth.feature's scenario, and is not restated
  # here. What is this feature's is the FAN-OUT: a deletion is a single click
  # that ends an unknown number of memberships and takes away every grant the
  # group held, and each of those has to arrive in the history separately and
  # attributably. A deletion recorded as one entry saying "group deleted" is
  # the shape that cannot answer an access review.

  @unit
  Scenario: Deleting a group records every access it took away, one by one
    When an administrator deletes "sec-eng"
    Then the grants it held are taken away as their own change
    And each membership it ended arrives as its own change
    And every one of them names the administrator who deleted the group
    And every one of them says the group was deleted

  # ═══ Closing the tenant ═══════════════════════════════════════════════

  @unit
  Scenario: Deleting a whole organization still works and says what it erases
    Given "acme" is being deleted entirely
    When the platform purges it
    Then the groups and the memberships go with it
    And that erasure is stated where it happens rather than left to a cascade
