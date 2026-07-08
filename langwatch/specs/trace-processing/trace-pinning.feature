Feature: Pinning traces
  As a user reviewing traces
  I want to pin traces I care about
  So that I can mark them as important and filter the trace list down to them

  Background:
    Given a project with traces

  Rule: Pins are stored on the trace itself, not a separate list

    Scenario: Pinning a trace
      When I pin a trace
      Then the trace shows as pinned
      And pinning it does not change how long the trace is retained

    Scenario: Unpinning a trace
      Given I have pinned a trace
      When I unpin the trace
      Then the trace no longer shows as pinned

    Scenario: Re-pinning a previously unpinned trace
      Given I pinned and then unpinned a trace
      When I pin the trace again
      Then the trace shows as pinned

  Rule: Sharing a trace pins it automatically until the share is removed

    Scenario: Sharing auto-pins the trace
      When I share a trace
      Then the trace shows as pinned

    Scenario: A shared trace cannot be unpinned by hand
      Given a trace that is shared
      When I try to unpin the trace
      Then the unpin is rejected
      And I am told to disable the share first

    Scenario: Unsharing removes the automatic pin
      Given a trace that is shared
      When I stop sharing the trace
      Then the trace no longer shows as pinned

    Scenario: A manual pin survives unsharing
      Given a trace that is shared
      And I have also pinned it by hand
      When I stop sharing the trace
      Then the trace still shows as pinned

  Rule: Pinned is a filter on the trace list

    Scenario: The Pinned facet is offered by default
      When I open the trace list filters
      Then a "Pinned" facet is available without me having to add it

    Scenario: Filtering the list to pinned traces
      Given some traces are pinned and some are not
      When I filter by pinned
      Then only pinned traces are listed
