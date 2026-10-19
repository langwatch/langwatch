Feature: The waterfall timeline draws a bar beside every span row

  The trace drawer's Waterfall view pairs the span tree with a timeline; both
  panes render the same virtualised rows. The timeline once kept the empty row
  list from its first render, because the React Compiler cached its reads of
  the stable virtualizer, so the axis showed and no bars did.

  @integration
  Scenario: Each span row in the tree has its bar in the timeline
    Given a trace with a root span and two child spans is open in the Waterfall view
    When the view has measured its viewport
    Then the timeline draws one bar for each span row in the tree
