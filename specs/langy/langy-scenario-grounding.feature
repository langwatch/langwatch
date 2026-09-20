Feature: A scenario reproduced from a trace keeps the identifiers the agent looks up
  As a person turning a failing production conversation into a scenario
  I want the scenario to carry the names, emails and ids the agent looked up
  So that the simulated user reproduces the failure instead of a lookup miss

  Background: stand-ins reproduce the wrong failure.
    A situation written with a stand-in ("colleague Zoe") makes the simulated
    user invent an email, the agent's lookup misses, and the run fails for a
    reason the original conversation never had. The identifiers the agent
    looks up (the tool-call inputs of the trace) travel verbatim into the
    situation; everything else sensitive keeps its structure with stand-ins.
    A `[REDACTED]` value means the project redacts PII at ingestion: the
    assistant asks the user for the value and never invents one. The rule
    lives in the agent-improve and scenarios skills, which Langy reads from
    the compiled native set.

  @unit
  Scenario: A reproduced scenario carries the trace's identifiers verbatim
    Given the compiled agent-improve and scenarios skills Langy reads
    When their bodies are inspected
    Then both tell the agent to copy the identifiers it looks up verbatim into the situation
    And both tell it that a redacted value is asked for, never invented

  @integration
  Scenario: Langy copies the identifier the agent looks up into the situation it reproduces
    Given a connected support agent that looks a colleague up by email
    And a failing conversation in which the customer names the colleague's email
    When the assistant is asked to reproduce the failure as a platform scenario
    Then the scenario it creates carries that email verbatim in its situation
    And the reply that reports the scenario proposes the connected agent as the target and asks whether to run it
