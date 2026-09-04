Feature: The plan allowance is enforced at every door that writes trace content

  A team's monthly allowance is one number, and the product has more than one
  door that spends it. The SDK collector and the OTLP receiver have always been
  gated on it. Reporting a scenario event is the third: a simulation run's
  events are trace content, written to the same store and counted the same way.

  # This existed and did nothing. The API process composed the guard the
  # scenario-event family asks for as a middleware that called `next()` and
  # returned — so an organization already over its cap kept writing through
  # that one door, and the allowance was advisory rather than enforced. The
  # gate itself was never missing: the ingest composition builds it, and the
  # collector and the receiver were both holding it. The scenario door was
  # simply handed a different, empty one.
  #
  # The fix is that all three doors hold the SAME gate object. A customer must
  # not be able to route around the allowance by choosing which door to send
  # through, and two gates over one team is exactly how that happens.

  Background:
    Given a project whose team is on a plan with a monthly message cap

  @integration
  Scenario: Reporting a scenario event over the allowance is refused
    Given the team has already spent its monthly allowance
    When a scenario event is reported for that project
    Then the write is refused as a plan limit rather than accepted
    And the refusal is terminal rather than one the client should retry

  @integration
  Scenario: Reporting a scenario event within the allowance is accepted
    Given the team is within its monthly allowance
    When a scenario event is reported for that project
    Then the event is written

  @integration
  Scenario: A deployment that meters nothing still accepts the event
    Given this deployment composed no plan allowance
    When a scenario event is reported for that project
    Then the event is written
    And the absent meter was named once at boot rather than once per request
