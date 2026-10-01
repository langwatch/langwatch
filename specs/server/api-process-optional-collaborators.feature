Feature: The API process builds the optional collaborators it can build itself
  As an operator running a LangWatch API deployment
  I want the process to answer its own optional ports from its own graph
  So that a surface is not left refusing on every deployment nobody hosts

  # WHY THIS EXISTS
  #
  # The production composition takes one flat options object, and every field
  # on it is optional so that a host can override what the process would build.
  # The runnable process supplies none of them: `api.main.ts` composes with `{}`.
  #
  # An option with a fallback degrades correctly under that — the process
  # builds its own. An option WITHOUT one does not degrade at all: the surface
  # behind it refuses by name on every deployment, forever, and reads to a
  # customer as an outage rather than as a capability nobody configured.
  #
  # Five of them were in the second shape: the caller's read-time redactions,
  # the reviewer's trace content, the setup checklist's simulation evidence,
  # the person-shaped messages, and the seat allowances the members page reads.

  Rule: an optional collaborator the process can build, the process builds

    @unit
    Scenario: Every optional collaborator the API process can build, it builds
      Given a deployment that configured a database, a queue and a mail host
      And no host supplies any of the process's optional collaborators
      When the API process composes
      Then it resolves the caller's read-time redactions from its own trace reads
      And it resolves the reviewer's trace content from its own trace application
      And it resolves the simulation evidence from its own simulation reads
      And it resolves the person-shaped messages from its own mail gateway
      And it resolves the seat allowances from its own plan and membership reads

    @unit
    Scenario: A collaborator whose graph is genuinely absent stays absent
      Given a deployment that configured no database
      When the API process composes
      Then the collaborators that stand on the database are absent
      And the surfaces behind them refuse by name rather than guessing an answer
