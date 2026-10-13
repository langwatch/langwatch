Feature: Deriving an evaluator id from a custom evaluation's name

  An SDK evaluation that names no `evaluator_id` gets one derived from its
  name. The derived id is the key: every evaluation for that name, from the
  collector, from the legacy evaluations route and from the trace ingestion
  subscriber, must land under the same id or one evaluator becomes several.

  Trace's custom-evaluation subscriber already refuses to restate the rule and
  asks for it by injection, saying Evaluation owns it. This is that rule, in
  Evaluation, so all three callers derive one id for one name.

  @unit
  Scenario: An underscore survives as a separator rather than vanishing
    Given an evaluation named with underscores
    When its evaluator id is derived
    Then each underscore reads as a separator in the derived id

  @unit
  Scenario: An unnamed evaluation gets a stable placeholder
    Given an evaluation with an empty name
    When its evaluator id is derived
    Then the placeholder name is used

  @unit
  Scenario: Every derived id is prefixed as a custom evaluator
    Given any evaluation name
    When its evaluator id is derived
    Then the id carries the custom-evaluator prefix
