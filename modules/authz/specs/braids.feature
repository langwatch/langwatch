# Decisions: dev/docs/adr/183-braids-show-matching-spans-in-another-projects-traces.md
# (ADR-183), on ADR-166 (the proof) and ADR-177 (the shared grant and the fence).
#
# Vocabulary, used exactly:
#   braid      a shared grant from an owner project to a reader project, with a condition
#   owner      the project that recorded the spans ("braid from")
#   reader     the project whose traces show them ("braid into")
#   condition  the OTTL subset a braid's spans must match, compiled when the braid is saved
#
# Who may braid: braids:manage on the owner and traces:view on the reader. Project roles come
# from teams, so a team admin holds braids:manage on every project in that team (ADR-183 §2).
#
# A scenario still tagged @unimplemented is not bound whole yet; it names the level its binding
# is expected at, and the note above it says which test is still missing.

@authz @grants @braids
Feature: Braids
  As an admin whose agents call agents in other projects
  I want one project's matching spans to show inside another project's traces
  So that the calling project sees its calls all the way down, without copying data

  Background:
    Given an Enterprise organisation with plain projects "orchestrator" and "specialists"
    And "orchestrator" and "specialists" belong to different teams
    And an organisation admin named ana
    And a member named sam who is not an admin

  Rule: A braid is a shared grant from the owner project to the reader project

    @integration
    Scenario: Creating a braid attaches a span read from the owner to the reader
      When ana braids "specialists" into "orchestrator" with the condition attributes["orchestrator"] == "web"
      Then the ledger holds a live project-reader grant whose principal is "orchestrator" and whose scope is "specialists"
      And its source is braid
      And its condition is of type span and carries the condition as written and in compiled form

    @unit
    Scenario: A span condition with a compiled where is a legal shared placement
      When a project-reader grant with a span condition carrying a where and its compiled form is placed on a foreign project
      Then the grant is accepted
      And the same grant with a where but no compiled form is refused
      And a trace condition carrying a where is still refused

    @integration
    Scenario: Braids need the Enterprise plan
      Given an organisation below Enterprise
      When ana asks to create or change a braid
      Then each is refused with enterprise_plan_required naming the Braids feature
      And removing a braid and listing the organisation's braids are not refused

    @unit
    Scenario Outline: A braid joins two plain projects of one organisation
      When ana asks to braid <owner> into <reader>
      Then the braid is refused with <code>

      Examples:
        | owner                              | reader                                     | code                        |
        | "specialists"                      | "specialists"                              | braid_into_itself           |
        | "specialists"                      | a project in another organisation          | braid_across_organizations  |
        | an aggregate project               | "orchestrator"                             | braid_aggregate_project     |
        | "specialists"                      | an aggregate project                       | braid_aggregate_project     |
        | the internal governance project    | "orchestrator"                             | braid_governance_project    |

    @unit
    Scenario: Several braids may join one pair of projects
      Given a live braid from "specialists" into "orchestrator" with the condition attributes["orchestrator"] == "web"
      When ana braids "specialists" into "orchestrator" with the condition name == "payments_agent"
      Then both braids are live

    @unit
    Scenario: A braid identical to a live one on the same pair is refused
      Given a live braid from "specialists" into "orchestrator"
      When ana asks for a braid with the same projects, condition, data window and end date
      Then the second braid is refused with braid_already_exists
      And the live braid is unchanged

    @integration
    Scenario: Two admins making the same braid at once leave one braid
      When ana and another organisation admin each ask for the same braid from "specialists" into "orchestrator" at the same moment
      Then exactly one of the two is live
      And the other request is refused with braid_already_exists

    @unit
    Scenario: Braids do not chain
      Given a live braid from "specialists" into "orchestrator"
      And a live braid from "orchestrator" into a third project "frontdesk"
      When a proof is minted for "frontdesk"
      Then it carries the braid from "orchestrator" and nothing braided into "orchestrator"

  Rule: Whoever holds braids:manage on the owner and can read the reader may braid

    @integration
    Scenario: A member may not create, change or remove a braid
      When sam, who may create public share links, asks to braid "specialists" into "orchestrator"
      Then the braid is refused as a permission denial
      And no grant is attached

    @integration
    Scenario: A project's admin may braid out of it into a project they can read
      Given tom is an admin of the team holding "specialists" and a viewer of "orchestrator"
      When tom braids "specialists" into "orchestrator"
      Then the braid is live
      And tom is named as its creator

    @unit
    Scenario: A team admin may braid out of every project in that team and no other
      Given tom is an admin of the team holding "specialists" and "billing"
      When tom's permissions are read
      Then tom holds braids:manage on "specialists" and on "billing"
      And on no project of another team

    @integration
    Scenario: Nobody braids into a project they cannot read
      Given tom is an admin of the team holding "specialists" and cannot read "orchestrator" traces
      When tom asks to braid "specialists" into "orchestrator"
      Then the braid is refused as a permission denial before anything is read or written

    @unit
    Scenario: A custom role listing braids:manage braids only where it is bound
      Given rui holds a custom role listing braids:manage and traces:view, bound to "specialists" alone
      And rui can read "orchestrator" traces
      When rui braids "specialists" into "orchestrator"
      Then the braid is live
      And rui's request to braid "orchestrator" into "specialists" is refused as a permission denial

    @unit
    Scenario: Nobody braids spans they could not read themselves
      Given rui holds braids:manage on "specialists" through a custom role that does not let rui read its traces
      When rui asks to braid "specialists" into "orchestrator"
      Then the braid is refused as beyond the caller's permissions

    @integration
    Scenario: Either project's admins may remove a braid
      Given a live braid from "specialists" into "orchestrator"
      And olu is an admin of the team holding "orchestrator" with no role on "specialists"
      When olu removes the braid from "orchestrator"
      Then the grant is revoked with reason braid_removed

    @unit
    Scenario: A braid cannot be removed from a project it does not touch
      Given a live braid from "specialists" into "orchestrator"
      And olu is an admin of a third project "frontdesk"
      When olu asks to remove the braid from "frontdesk"
      Then the removal is refused with braid_not_on_project
      And the braid stays live

  Rule: An organisation can keep braids to its admins

    @unit
    Scenario: Project admins may braid until the organisation keeps braids to its admins
      Given an organisation that has never changed who may braid
      And tom is an admin of the team holding "specialists"
      When tom's permissions are read
      Then tom holds braids:manage on "specialists"

    @integration
    Scenario: With braids kept to organisation admins, a team admin may not braid
      Given the organisation keeps braids to its admins
      And tom is an admin of the team holding "specialists" and a viewer of "orchestrator"
      When tom asks to braid "specialists" into "orchestrator"
      Then the braid is refused as a permission denial
      And ana's request for the same braid is accepted

    @integration
    Scenario: Keeping braids to organisation admins leaves live braids in place
      Given a live braid from "specialists" into "orchestrator" that tom created
      When ana keeps braids to the organisation's admins
      Then the braid stays live
      And within thirty seconds tom may no longer change or remove it

    @integration
    Scenario: Only an organisation admin may change who can braid
      When tom asks to keep braids to the organisation's admins
      Then the change is refused as a permission denial
      And ana's change is accepted and in the audit log

    @integration
    Scenario: Changing who can braid needs the Enterprise plan
      Given an organisation below Enterprise
      When ana asks to keep braids to the organisation's admins
      Then the change is refused with enterprise_plan_required naming the Braids feature

  Rule: A condition is an OTTL subset, compiled once when the braid is saved

    @unit
    Scenario Outline: A condition in the supported set compiles
      When ana saves a braid with the condition <condition>
      Then the condition compiles
      And every literal and attribute key in it is a bound parameter, never statement text

      Examples:
        | condition                                                         |
        | attributes["orchestrator"] == "web"                               |
        | resource.attributes["service.name"] == "checkout"                 |
        | name == "payments_agent"                                          |
        | attributes["orchestrator"] != nil                                 |
        | attributes["orchestrator"] == "web" and Verified("orchestrator")  |

    @unit
    Scenario Outline: An unsupported condition is refused with a fix the admin can act on
      When ana saves a braid with the condition <condition>
      Then the braid is refused with braid_condition_unsupported
      And the refusal names <construct> and how to write it instead

      Examples:
        | condition                                                       | construct                |
        | attributes["a"] == "x" or attributes["b"] == "y"                | or                       |
        | not attributes["a"] == "x"                                      | not                      |
        | IsMatch(attributes["a"], "^x")                                  | IsMatch                  |
        | attributes["latency"] > 100                                     | a numeric comparison     |
        | attributes["a"] != "x"                                          | != with a value          |
        | attributes["flag"] == true                                      | a comparison with true   |
        | attributes["a"] == ""                                           | an empty string          |
        | attributes["orchestrator"] matches "w.*"                        | the operator matches     |

    # Unimplemented: the proof is bound (an unconditioned span window); no fence or trace-read test
    # yet shows every owner span of the reader's trace read through a braid with no condition.
    @unit @unimplemented
    Scenario: A braid with no condition braids every owner span in the reader's traces
      When ana saves a braid from "specialists" into "orchestrator" with no condition
      Then the braid is accepted
      And every "specialists" span sharing a trace id with an "orchestrator" trace is braided

    @unit
    Scenario: A compiled condition carries the compiler's version
      When ana saves a braid with a condition
      Then the stored condition carries the compiler version that compiled it
      And every cache key the fence feeds changes when the condition or the compiler version changes

    @unit
    Scenario: A condition too large to read is refused
      When ana saves a braid whose condition is longer, holds more comparisons or nests deeper than a condition may
      Then the braid is refused with braid_condition_too_large
      And the refusal says which limit it passed

    # Unimplemented: the limit's refusal is unit-tested; no test yet runs the largest legal braided
    # read against ClickHouse.
    @integration @unimplemented
    Scenario: A reader's distinct conditions fit in one statement
      Given "orchestrator" receives braids with the most distinct conditions a reader may hold
      When a trace is opened in "orchestrator"
      Then the read runs within the statement size ClickHouse accepts
      And one more distinct condition is refused with braid_condition_limit_reached

  Rule: Changing a braid replaces it, and removing one ends it

    @integration
    Scenario: Changing a braid replaces it and names the braid it replaced
      Given a live braid from "specialists" into "orchestrator"
      When ana changes its condition
      Then a new grant with the new condition is attached and the old one revoked
      And the new grant names the grant it replaces
      And the old braid is no longer live

    @integration
    Scenario: Two people changing one braid at once leave one change
      Given a live braid from "specialists" into "orchestrator"
      When ana and another organisation admin each change its condition at the same moment
      Then one change is live
      And the other is refused with braid_changed
      And no third grant is attached

    @unit
    Scenario: A change that is not valid writes nothing
      Given a live braid from "specialists" into "orchestrator"
      When ana changes its condition to one that is not supported
      Then the change is refused with braid_condition_unsupported
      And the live braid is unchanged

    @integration
    Scenario: A change whose new grant cannot be attached leaves the braid as it was
      Given a live braid from "specialists" into "orchestrator"
      And attaching a grant fails
      When ana changes its condition
      Then the change reports failure
      And the old braid is still live with its old condition

    @integration
    Scenario: A change whose old grant cannot be revoked reports failure and finishes when repeated
      Given a live braid from "specialists" into "orchestrator"
      And revoking a grant fails once
      When ana changes its condition
      Then the change reports failure
      And repeating the change revokes the old grant without attaching a third

    @unit
    Scenario: A change that would make a braid identical to another live braid is refused
      Given two live braids from "specialists" into "orchestrator" with different conditions
      When ana changes one braid's condition to the other's
      Then the change is refused with braid_already_exists
      And both braids stay live as they were

    @integration
    Scenario: Replaying the grant events rebuilds which braid each change replaced
      Given a braid made by changing another, and a braid attached before changes named what they replace
      When the grant events are replayed into the grant projection
      Then the changed braid names the braid it replaced
      And the older braid names none

    @integration
    Scenario: Removing and making a braid again within one second leaves one live braid
      Given a live braid from "specialists" into "orchestrator"
      When ana removes it and braids the same pair again within the same second
      Then the new braid is live under a grant id of its own
      And the removed braid stays removed

    @integration
    Scenario: A removed braid stops showing within thirty seconds
      Given a live braid from "specialists" into "orchestrator"
      When ana removes the braid
      Then the grant is revoked with reason braid_removed
      And within thirty seconds no "orchestrator" trace shows a "specialists" span

    @integration
    Scenario: A read holding its proof stops showing a removed braid within thirty seconds
      Given sam keeps a live view of an "orchestrator" trace holding braided "specialists" spans
      When ana removes the braid
      Then within thirty seconds the live view shows no "specialists" span
      And no proof carrying a braid is used after thirty seconds from its minting

    @unit
    Scenario: A braid stops showing at its end date
      Given a braid from "specialists" into "orchestrator" that ends at a date
      When the date passes
      Then no "orchestrator" trace shows a "specialists" span
      And the braid is not recorded as removed

    @unit
    Scenario: "Data from" limits which spans show, not how long the reader sees them
      Given a braid whose data starts on 1 October and which never ends
      When an "orchestrator" trace holds "specialists" spans from 30 September and 2 October
      Then only the span from 2 October is braided
      And the braid keeps granting after 1 October

    @integration
    Scenario: A braid's data may start before the day it was made
      Given an "orchestrator" trace from last month holding matching "specialists" spans
      When ana braids "specialists" into "orchestrator" today with data from the start of last month
      Then the trace shows the matching "specialists" spans
      And an "orchestrator" trace from before the data window shows none

  Rule: Both projects list the braid

    @integration
    Scenario: The owner lists the braids out of it and the reader the braids into it
      Given a live braid from "specialists" into "orchestrator"
      When ana lists braids on "specialists"
      Then the braid is listed under the braids into other projects with its condition, window, end date and creator
      And listing braids on "orchestrator" shows the same braid under the braids from other projects

    @integration
    Scenario: Members of either project may list the braids that touch it
      Given a live braid from "specialists" into "orchestrator"
      And sam is a member of "orchestrator" and not of "specialists"
      When sam lists braids on "orchestrator"
      Then the braid from "specialists" is listed
      And listing braids on "specialists" is refused to sam as a permission denial

  Rule: The braid dialog names how many people will see the braided spans

    @unit
    Scenario: The people who will see braided spans are the reader's members who can read its traces
      Given ana is an organisation admin and tom a member of the team holding "orchestrator"
      And sam is a member of another team only, and a member of the team holding "orchestrator" is on a disabled seat
      When the number of people who will see spans braided into "orchestrator" is asked for
      Then the answer is 2, and it is exact

    @unit
    Scenario: In a large organisation the number of people is a floor
      Given an organisation with more active members than one count decides
      When the number of people who will see spans braided into one of its projects is asked for
      Then the answer counts the members decided and says it is not exact

    @unit
    Scenario: Only someone who can read the reader's traces may ask how many people will see them
      When the number of people who will see spans braided into "orchestrator" is asked for
      Then the route declares traces:view at "orchestrator" before it answers

  Rule: The braid dialog offers only projects whose traces the viewer can read

    @unit
    Scenario: The picker decides every listed project for the viewer at once
      Given "specialists", "orchestrator" and an aggregate project "rollup" in ana's organisation
      When ana, an organisation admin, asks where a braid from "specialists" may go
      Then "orchestrator" may be picked
      And "specialists" is refused as the braid's own project and "rollup" as an aggregate
      And every asked project's team and organisation come from one read, not one per project

    @unit
    Scenario: Projects whose traces the viewer cannot read are left out
      Given tom is an admin of the team holding "specialists" only
      When tom asks where a braid from "specialists" may go
      Then "orchestrator" is left out, and so is a project of another organisation

    @unit
    Scenario: Only someone who may braid from a project may ask where it can braid into
      When the projects a braid from "specialists" may go into are asked for
      Then the route declares braids:manage at "specialists" before it answers

  Rule: Every braid change and every read through a braid is audited

    @integration
    Scenario: Creating, changing and removing a braid is in the audit log
      When ana creates, changes and then removes a braid
      Then the audit log holds an entry for the creation, two for the change and one for the removal
      And the change's entries are a removal and a creation naming the braid it replaced
      And every entry names both projects and the condition

    @unit
    Scenario: A braid's audit entries are filed under the braid and its owner project
      When ana creates, changes and then removes a braid from "specialists" into "orchestrator"
      Then every entry names the braid it is about as its target and "specialists" as its project
      And the change's creation names the braid it replaced
      And so "View in audit log" on a braid finds its entries

    @unit
    Scenario: A shared read that is not a braid names no braid in the audit log
      When an aggregate project's shared read of "specialists" is attached and later revoked
      Then both entries are written exactly as any other grant's, naming no target and no project

    @unit
    Scenario: A read through a braid is filed under the reader project
      Given a live braid from "specialists" into "orchestrator"
      When sam opens an "orchestrator" trace holding "specialists" spans
      Then the braided spans viewed entry is filed under "orchestrator"

    @integration
    Scenario: Opening traces with braided spans is audited once per five minutes
      Given a live braid from "specialists" into "orchestrator"
      When sam opens three "orchestrator" traces holding "specialists" spans within five minutes
      Then one braided spans viewed entry names sam, "orchestrator" and "specialists"
      And it names no span and no trace content

  Rule: Braids pause below Enterprise and are kept

    @unit
    Scenario: After leaving Enterprise, braids stop showing and are kept
      Given a live braid from "specialists" into "orchestrator"
      When the organisation leaves Enterprise
      Then no "orchestrator" trace shows a "specialists" span
      And the braid is still listed, marked paused
      And an admin can still remove it
      And returning to Enterprise shows the braided spans again without recreating the braid
