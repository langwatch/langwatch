# Decisions: dev/docs/adr/183-braids-show-matching-spans-in-another-projects-traces.md
# (ADR-183) sections 5 to 7. The braid itself: modules/authz/specs/braids.feature.
# Design: dev/docs/plans/braids/braids-prototype.html, steps 5 and 6.
#
# Vocabulary, used exactly:
#   braided span  an owner project's span shown in a reader project's trace through a braid
#   owner         the project that recorded the span; reader, the project showing it
#
# EVERY SCENARIO IS @unimplemented: none of this is built. Each carries the level its
# binding is expected at, and the pull request that builds it binds it.

@trace @braids
Feature: Braided spans in the reader's traces
  As a member of a project whose agents call agents in other projects
  I want the spans other projects braid into mine to show inside my traces
  So that I can follow a call all the way down without leaving my project

  Background:
    Given plain projects "orchestrator" and "specialists" in one Enterprise organisation
    And a live braid from "specialists" into "orchestrator" with the condition attributes["orchestrator"] == "web"
    And a member named sam of "orchestrator" who is not a member of "specialists"

  Rule: Braided spans appear only in traces the reader already has

    @integration
    Scenario: A reader's trace shows the owner's matching spans
      Given an "orchestrator" trace whose call into "specialists" recorded spans under the same trace id
      When sam opens the trace
      Then the "specialists" spans carrying orchestrator "web" appear in the trace
      And each sits under its parent span as it ran

    @integration
    Scenario: Owner spans that do not match never reach the reader
      Given an "orchestrator" trace whose "specialists" spans carry orchestrator "web" and orchestrator "app"
      When sam opens the trace
      Then only the spans carrying orchestrator "web" are read for "orchestrator"

    @integration @unimplemented
    Scenario: A trace only the owner holds is not listed for the reader
      Given a "specialists" trace that "orchestrator" recorded nothing in
      When sam lists or searches "orchestrator" traces
      Then that trace is not listed
      And opening its id from "orchestrator" is answered as not found

    @integration @unimplemented
    Scenario: Spans are matched per owner by trace id
      Given a third project "search" braided into "orchestrator"
      And "specialists" and "search" each hold spans under the trace id of one "orchestrator" trace
      When sam opens the trace
      Then each owner's matching spans appear, each under its own project

    @integration
    Scenario: The condition is applied to each span's latest version
      Given a "specialists" span that matched the condition until a later version of it stopped matching
      When sam opens the trace
      Then the span does not appear

    @integration
    Scenario: Spans outside the braid's data window do not appear
      Given a braid whose data starts on 1 October
      And an "orchestrator" trace holding matching "specialists" spans from before and after 1 October
      When sam opens the trace
      Then only the spans from 1 October onwards appear

    @integration @unimplemented
    Scenario: Two braids on one pair show spans matching either, each inside its own window
      Given a second live braid from "specialists" into "orchestrator" with the condition name == "payments_agent" and data from 1 October
      And an "orchestrator" trace holding "specialists" spans that match only the first braid, only the second, and neither
      When sam opens the trace
      Then the spans matching either braid appear
      And a span matching only the second braid appears only when it started on or after 1 October

    @unit
    Scenario: Two projects holding the same span id show both spans
      Given "orchestrator" and "specialists" each hold a span with the same span id in one trace
      When the trace is read for "orchestrator"
      Then both spans are returned, each naming its owning project

    @integration @unimplemented
    Scenario: A braided span's large body is read from its owning project
      Given a matching "specialists" span whose input was stored apart because of its size
      When sam opens that span
      Then its input is read from where "specialists" stored it

  Rule: Each span keeps its owner's privacy

    @integration @unimplemented
    Scenario: A braided span is redacted under its owning project's policy
      Given "specialists" hides span input and output from everyone
      And "orchestrator" shows span input and output to its members
      When sam opens a trace holding spans from both
      Then the "specialists" spans show no input or output
      And the "orchestrator" spans show theirs

    @unit @unimplemented
    Scenario: A viewer with no role on the owner project is outside its role-keyed audiences
      Given "specialists" shows span input only to its own admins
      When sam, an admin of "orchestrator" with no role on "specialists", opens a braided span
      Then the span's input is hidden

  Rule: The trace view says where each span came from

    @integration @unimplemented
    Scenario: A braided span carries a badge naming its owning project
      When sam opens a trace holding braided spans
      Then each braided span carries a badge reading "Specialists"
      And the trace header says it includes spans from "specialists"

    @unit
    Scenario: A braided span whose parent was not braided is shown at the top of the trace
      Given a matching "specialists" span whose parent span does not match the condition
      When the trace's span tree is built for "orchestrator"
      Then the span is shown at the top of the trace, as a span with a missing parent is
      And nothing about the parent that was not braided is read to place it

    @unit
    Scenario: A braided span whose parent the reader can see hangs under it
      Given a matching "specialists" span whose parent is an "orchestrator" span
      When the trace's span tree is built for "orchestrator"
      Then the span hangs under that "orchestrator" span

    @unit
    Scenario: Nothing hints at owner spans that were not braided
      Given an "orchestrator" trace whose "specialists" spans partly match the condition
      When the trace is read for "orchestrator"
      Then no count, gap or placeholder stands for the spans that did not match

    @integration @unimplemented
    Scenario: Actions that would act on the owner's data are off on a braided span, with a reason
      When sam selects a braided span
      Then opening it in the playground, annotating it and evaluating it are off, each saying why
      And the span says it is shown because it matches the braid's condition

    @integration @unimplemented
    Scenario: Opening the owner project is offered only to someone who can open it
      When sam selects a braided span
      Then no link to open it in "specialists" is offered
      And a viewer who can read "specialists" is offered that link

    @integration @unimplemented
    Scenario: The trace header's totals include braided spans and say so
      Given an "orchestrator" trace holding braided spans with their own cost and tokens
      When sam opens the trace
      Then the header's duration, cost and tokens include the braided spans and say so
      And the trace's row in the list keeps the totals of "orchestrator" spans alone

  Rule: Outside the trace view, a project shows only its own spans in the first release

    @integration @unimplemented
    Scenario Outline: <surface> shows only the project's own spans
      Given an "orchestrator" trace holding braided spans
      When sam reads it through <surface>
      Then only "orchestrator" spans are read

      Examples:
        | surface                         |
        | the trace list and its totals   |
        | search and filters              |
        | analytics                       |
        | the REST trace API              |
        | the MCP server                  |
        | a trace export                  |
        | Langy                           |

    @unit
    Scenario: A public share link of a trace shows only the project's own spans
      Given an "orchestrator" trace holding braided spans
      When someone opens a public share link to it
      Then only "orchestrator" spans are read

  Rule: Evaluations are not shared in either direction

    @integration @unimplemented
    Scenario: The owner's evaluation results are not shown on braided spans
      Given a "specialists" monitor scored a span that is braided into an "orchestrator" trace
      When sam opens the trace
      Then no "specialists" evaluation result is shown
      And the span says evaluations from "specialists" stay in that project

    @integration @unimplemented
    Scenario: No reader monitor runs on a braided span
      Given an "orchestrator" monitor on every span
      When "specialists" records a span that is braided into an "orchestrator" trace
      Then the "orchestrator" monitor does not run on it

  Rule: A trace read carries the caller's proof all the way down

    @unit
    Scenario: A trace content read cannot swap the route's proof for an own-only one
      When a trace operation that reads span content mints its own proof instead of taking the caller's
      Then the trace route gate fails the build
      # Today the trace app mints an own-only proof for content reads, which is
      # why braided spans could never appear. Next to the route gate in
      # specs/governance/aggregate-project.feature.

  Rule: The braid dialog previews what the reader will see

    @integration @unimplemented
    Scenario: The preview counts the reader's last 7 days of traces
      Given "orchestrator" recorded traces over the last 7 days, some holding matching "specialists" spans
      When an admin previews a condition for a braid from "specialists" into "orchestrator"
      Then the preview counts the traces that get every "specialists" span, some of them, or none
      And traces with nothing braided are still counted

    @integration @unimplemented
    Scenario: The preview counts calls that would stay hidden for want of a valid signature
      When an admin previews a condition requiring signed calls
      Then the preview counts the otherwise matching calls whose signature is missing or invalid

    @integration @unimplemented
    Scenario: Testing a trace renders it exactly as the reader will see it
      When an admin tests a condition against an "orchestrator" trace id
      Then that trace is returned with exactly the spans "orchestrator" would see under the condition

    @integration @unimplemented
    Scenario: The preview asks for read access on both projects at the door
      Given an admin who can read "specialists" traces but not "orchestrator" traces
      When the admin previews a braid from "specialists" into "orchestrator"
      Then the preview is refused as a permission denial before it reads anything
      And the same holds the other way round

    @integration @unimplemented
    Scenario: The preview needs the Enterprise plan
      Given an organisation below Enterprise
      When an admin previews a braid
      Then the preview is refused with enterprise_plan_required naming the Braids feature

    @integration @unimplemented
    Scenario: The preview never reads a trace the reader does not have
      Given a "specialists" trace that "orchestrator" recorded nothing in
      When an admin previews or tests a condition that it matches
      Then that trace is neither counted nor returned
