Feature: Unbreakable strings wrap inside their message containers
  As a reader of agent output
  I want long tokens without break opportunities to stay inside their bubble
  So that the end of a URL or id is never painted off-screen

  # Agent transcripts are full of whitespace-free payloads (JSON argument
  # blobs, signed URLs, base64). The default overflow-wrap only breaks at
  # whitespace, so such a token painted past its box and grew horizontal
  # scrollbars on every surface that renders messages. The fix lives at the
  # shared roots, not per call site:
  #   platform/app/src/components/ui/prose.tsx            (Markdown -> Prose root)
  #   platform/app/src/features/traces-v2/components/TraceDrawer/markdownView/RenderedMarkdown.tsx
  #   platform/app/src/components/traces/RenderInputOutput.tsx (raw mono fallbacks)
  #
  # Two further rules applied in the same change, verified by review rather
  # than a bound test because jsdom cannot resolve Chakra's compiled styles:
  #   - Message scroll regions pair overflowY="auto" with an explicit
  #     overflowX="hidden" (ScenarioMessageRenderer, ScenarioRunDetailDrawer,
  #     AnnotationCard) so stray overflow clips instead of computing
  #     overflow-x to auto and growing a scrollbar.
  #   - ScenarioTargetRow's truncating name cell carries minWidth={0}, so the
  #     flex child shrinks below its text width and ellipses.
  # House pattern for bare Text surfaces: wordBreak="break-word", matching
  # AnnotationOutputDiff.tsx.

  Background:
    Given the user is authenticated with "traces:view" permission

  @integration
  Scenario: A message body carries the wrap rule to every prose element
    When a message renders through Markdown whose text is one unbreakable token
    Then the prose root resolves overflow-wrap "anywhere"
    And list items, table cells and links inherit the same rule

  @integration
  Scenario: Fenced code blocks scroll instead of breaking mid-token
    Given a message containing a fenced code block with a long token
    Then the block keeps overflow-x auto
    And the code does not gain soft wrap opportunities from the wrap rule

  @integration
  Scenario: Raw tool input and output strings wrap instead of painting wide
    Given a raw string rendered by RenderInputOutput outside the JSON viewer
    Then the mono Text carries word-break "break-word"
