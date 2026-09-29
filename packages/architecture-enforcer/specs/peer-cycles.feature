Feature: Peer Api cycles shrink to zero, then refuse
  As a maintainer
  I want every module pair that depends on each other's Api reported, and no new one landing
  So that the kernel can refuse a peer cycle at boot by name once the last one is cut

  See dev/docs/ARCHITECTURE.md §5 (Alex, 2026-09-29): a shrink-only list is the transition.

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
  Scenario: No new peer cycle edge lands
    Given the checked-in list of today's peer cycle edges
    When the tree's peer cycle edges are read
    Then none is missing from the list

  @unit @architecture
  Scenario: A cut peer cycle edge leaves the list in the same change
    Given the checked-in list of today's peer cycle edges
    When the tree's peer cycle edges are read
    Then every listed edge still exists
