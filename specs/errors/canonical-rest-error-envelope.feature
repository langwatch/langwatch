Feature: The canonical REST envelope carries the remediation channel

  The canonical envelope nests the refusal under `error` and spells its keys
  the way the Go data plane does, so one consumer reads either plane. That
  contract always included the remediation channel — `tips`, `docs_url` and
  `fault` — but only the Go side ever emitted it: the TypeScript boundary
  built the envelope from the code, sentence, meta and trace ids alone, so a
  refusal that knew exactly what to do next reached the caller with no next
  step and no way to tell whose mistake it was.

  Correlation is the other half. A response carries the request's trace and
  span ids once, on the envelope. Repeating them on every entry of the reasons
  chain says nothing new — each reason was raised inside the same request —
  and spends a second spelling of the same two fields in the same body.

  @unit
  Scenario: A handled refusal ships its remediation channel in the envelope
    Given a route on a canonical-envelope family raises a handled refusal with remediation copy
    When the refusal is rendered
    Then the envelope carries the refusal's tips
    And the envelope carries the refusal's documentation link
    And the envelope says who can act on it

  @unit
  Scenario: A refusal made of several facts ships its reasons chain
    Given a route on a canonical-envelope family raises a refusal carrying one reason per rejected field
    When the refusal is rendered
    Then the envelope carries a reason for each rejected field

  @unit
  Scenario: A response carries one trace-id pair
    Given a traced request raises a refusal carrying a reason of its own
    When the refusal is rendered
    Then the trace and span ids appear once, on the envelope
    And no entry of the reasons chain repeats them
