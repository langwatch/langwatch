Feature: A scenario reproduced from a trace invents its identifiers and seeds the lookup
  As a person turning a failing production conversation into a scenario
  I want the scenario to run on test data of its own
  So that it reproduces the failure without carrying the customer's details

  Background: a simulation runs on invented data, named and seeded.
    A scenario is a simulation, so the names, emails and ids it needs are
    invented rather than copied out of the trace, and a `[REDACTED]` value is
    invented too rather than asked for. The invented value is named in the
    situation, because a situation that leaves a role unnamed lets the
    simulated user make a different address up on every run. An identifier the
    agent looks up needs a record in the agent's fixtures or test data, added
    in the same change when it is missing: a lookup that always misses proves
    the miss rather than the behaviour under test. The rule lives in the
    agent-improve and scenarios skills, which Langy reads from the compiled
    native set.

  @unit
  Scenario: A reproduced scenario invents its identifiers and seeds the lookup
    Given the compiled agent-improve and scenarios skills Langy reads
    When their bodies are inspected
    Then both tell the agent to invent a stand-in rather than ask for a redacted value
    And both tell it that an unnamed role costs the run its reproducibility
    And both tell it to seed the looked-up record in the agent's fixtures or test data

  @integration
  Scenario: Langy names the looked-up identifier in the situation it writes
    Given a connected support agent that looks a colleague up by email
    And a failing conversation in which the customer asks for a colleague to be looped in
    When the assistant is asked to reproduce the failure as a platform scenario
    Then the situation it writes names one concrete colleague email the agent can look up
    And the reply that reports the scenario proposes the connected agent as the target and asks whether to run it
