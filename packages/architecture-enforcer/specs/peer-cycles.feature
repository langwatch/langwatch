Feature: Peer Api cycles are refused
  As a maintainer
  I want every module pair that depends on each other's Api reported, but for the named exceptions Alex kept
  So that the kernel can refuse a peer cycle at boot by name once the last one is cut

  See dev/docs/ARCHITECTURE.md §5 (Alex, 2026-10-05): the allowed list is deleted and the test stays red until every cycle is cut.
  One named exception holds organization <-> identity (Alex, 2026-10-08, round 29 PC-1): owned, reasoned, shrink-only.

  @unit @architecture
  Scenario: A peer dependency whose peer reaches back is a cycle edge
    Given module a's static dependencies name b's Api and b's name a's Api
    When the peer-cycles policy reads the process apps
    Then it reports both edges, each naming the way back

  @unit @architecture
  Scenario: A peer dependency the peer cannot reach back through is not reported
    Given module a depends on b's Api and nothing b depends on reaches a
    When the peer-cycles policy reads the process apps
    Then it reports nothing

  @unit @architecture
  Scenario: A dependency map held in a constant of another file is followed
    Given an app whose static dependencies name a constant imported from a sibling file
    When the peer-cycles policy reads the process apps
    Then the peers that constant names are its edges

  @unit @architecture
  Scenario: No peer cycle edge exists
    Given the tree's modules and their static Api dependencies
    When the tree's peer cycle edges are read
    Then the list of edges is empty

  @unit @architecture
  Scenario: A named exception keeps exactly its two-module cycle
    Given modules a and b depend on each other's Api and a named exception holds a <-> b
    When the peer-cycles policy reads the process apps
    Then it reports nothing and keeps both edges

  @unit @architecture
  Scenario: A named exception does not hide a longer loop through its pair
    Given a named exception holds a <-> b and b also reaches a through c
    When the peer-cycles policy reads the process apps
    Then it reports the edges on the longer loop, each naming the way back that avoids the pair

  @unit @architecture
  Scenario: A named exception whose modules no longer name each other is reported for deletion
    Given a named exception holds a <-> b and only a depends on b
    When the peer-cycles policy reads the process apps
    Then it reports the exception and asks for it to be deleted

  @unit @architecture
  Scenario: A named exception without an owner, a reason or a ruling is refused
    Given a named exception whose owner is not one of its two modules, or whose reason or ruling is blank
    When the peer-cycles policy reads the process apps
    Then it reports the exception naming what is missing

  @unit @architecture
  Scenario: The named exceptions hold no pair beyond the ruled ones
    Given the policy's named exceptions
    When they are compared with the pairs Alex ruled
    Then none is beyond them

  @unit @architecture
  Scenario: Every named exception still names its cycle
    Given the tree's modules and the policy's named exceptions
    When the named exceptions are checked against the tree
    Then each is well formed and its two modules still depend on each other's Api
