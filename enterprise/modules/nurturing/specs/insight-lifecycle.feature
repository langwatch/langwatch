Feature: Insight acts reach PostHog through nurturing

  Insight records each insight's filing and its owner's acts on its own pipeline.
  Nurturing subscribes to those facts and tells PostHog once per fact, on the
  person who acted (a filing on its owner, else its filer), as `insights.<act>.insight`. No title, body, query or insight
  id is sent; a filing carries only how it was filed, its tone and whether it
  came from a board.

  @unit
  Scenario: A filed insight is tracked once on its owner with its bounded facts
    When insight records a filing owned by user-1, filed by a run, with tone "bad", from a board
    Then nurturing delivers one insight_acted signal for user-1 with act "filed"
    And PostHog tracks insights.filed.insight with filedVia "run", tone "bad" and fromBoard true
    And no title, body, query or insight id is in the properties

  @unit
  Scenario: A filing with no owner is tracked on its filer
    When insight records a filing with no owner, filed by user-2
    Then nurturing delivers one insight_acted signal for user-2 with act "filed"

  @unit
  Scenario: A filing with no owner and no filer sends nothing
    When insight records a filing stored before owners with no filer
    Then nurturing delivers no signal

  @unit
  Scenario Outline: The owner's act on an insight is tracked once on that person
    When insight records that user-1 <act> an insight
    Then nurturing delivers one insight_acted signal for user-1 with act "<act>"
    And PostHog tracks insights.<act>.insight with no properties of its own

    Examples:
      | act      |
      | seen     |
      | archived |
      | kept     |

  @unit
  Scenario: The same insight fact delivered twice is tracked once
    When insight's seen fact for user-1 is delivered twice
    Then PostHog tracks insights.seen.insight once

  @unit
  Scenario: A renewed insight is not tracked
    When insight records that a run renewed an insight
    Then nurturing has no subscriber for it, because the fact names no person
