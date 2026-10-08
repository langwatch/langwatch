# fuzz ui -vision asks a vision model whether a settled page looks wrong: a stuck
# spinner, an empty panel, overlap, "undefined" or an error toast. Its findings
# must be stable across runs and cheap, so the logic is pinned with a fake judge.
#
# Bound by vitest in tools/fuzz/runner, annotated `/** @scenario */`.

Feature: fuzz vision check files looks-wrong defects once, stably and cheaply

  Rule: The vision check runs only when asked

    @unit
    Scenario: A plan without vision never asks the judge
      Given a plan.json that does not set vision
      When the runner reads it
      Then the vision check is off

  Rule: A vision finding is grouped by route, kind and element

    @unit
    Scenario: Two wordings of one defect on one element share a signature
      Given the judge reports a stuck spinner on the same element of the same route twice
      And the two messages are worded differently
      When the findings are signed
      Then both carry the signature of route, kind and element

  Rule: A page is judged once until it looks different

    @unit
    Scenario: The same screenshot of a route is not judged twice
      Given a route whose screenshot was judged
      When the same screenshot of that route is checked again
      Then the judge is not asked
      And a changed screenshot of that route is judged

  Rule: A flagged page is judged a second time and only agreed findings stand

    @unit
    Scenario: A finding the second judgement does not repeat is dropped
      Given the first judgement flags two elements
      And the second judgement flags only one of them
      When the vision check finishes the page
      Then only the finding both judgements named is filed

    @unit
    Scenario: A clean page is judged once
      Given the first judgement flags nothing
      When the vision check finishes the page
      Then the judge was asked once

  Rule: Every judged page records what it cost

    @unit
    Scenario: The cost ledger counts calls, tokens and dollars per page
      Given a page judged twice
      When the ledger is read
      Then it records both calls, their tokens and the page's cost

    @unit
    Scenario: A judge that fails files no finding and is counted
      Given a judge that answers with an error
      When a page is checked
      Then no finding is filed
      And the ledger counts the failure with its first message
