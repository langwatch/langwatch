Feature: Peer Api cycles are refused
  As a maintainer
  I want every module pair that depends on each other's Api reported, with no list allowing any
  So that the kernel can refuse a peer cycle at boot by name once the last one is cut

  See dev/docs/ARCHITECTURE.md §5 (Alex, 2026-10-05): the allowed list is deleted and the test stays red until every cycle is cut.

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
