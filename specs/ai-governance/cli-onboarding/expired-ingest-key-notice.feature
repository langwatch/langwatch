Feature: The dashboard tells you when a coding agent's session died
  As a developer whose coding agent sends OTLP straight to LangWatch
  When the ingestion key `langwatch login --device` minted for it stops working
  I want LangWatch to tell me, wherever I am in the app
  So that I find out my traces stopped arriving from the dashboard instead of
  from a gap in a chart weeks later.

  `langwatch <tool>` wrappers can prompt: they own a terminal and can ask the
  user to log in again on the spot. Claude Code and anything else pointed at
  the OTLP endpoint through plain environment variables cannot. Those exporters
  retry into a 401 forever and report nothing, so the rejection has to be
  recorded server-side and surfaced in the UI.

  What makes a key stop working: `langwatch login --device` rotates the
  previous key hard, an admin or the owner revokes it from the API keys
  settings, or the owning user is deactivated. Persisted wiring left behind by
  an earlier login then holds a key nothing will accept.

  Pairs with:
    - specs/ai-governance/cli-wrappers/cli-mints-ingest-key.feature (how the key is minted)
    - specs/ai-governance/cli-wrappers/wrap-path-choice.feature (the wrapper-side prompt)

  Rule: OTLP ingest records a rejection it can attribute to a user

    @integration
    Scenario: A revoked ingestion key stamps its owner
      Given a personal ingestion key minted for a coding agent
      And the key has since been revoked
      When the agent posts OTLP traces with that key
      Then the request is still rejected with 401
      And the key's owner is stamped with the time of the attempt

    @integration
    Scenario: A key whose owner was deactivated is still attributed
      Given a personal ingestion key whose owning user has been deactivated
      When the agent posts OTLP traces with that key
      Then the key's owner is stamped with the time of the attempt

      # Authentication deliberately cannot see keys owned by deactivated
      # users, so attribution reads the row without that filter. Nothing
      # about the read authorizes anything.

    @integration
    Scenario: A working key is never mistaken for a dead one
      Given a personal ingestion key that is live
      When the attribution check runs for that key
      Then nothing is recorded

    @integration
    Scenario: A bearer that is not a LangWatch key is ignored
      Given a bearer token that does not carry a LangWatch key prefix
      When the attribution check runs for it
      Then nothing is recorded and no user is touched

    @integration
    Scenario: A well-shaped token for an unknown key is ignored
      Given a token shaped like an ingestion key whose lookup id matches no row
      When the attribution check runs for it
      Then nothing is recorded and no user is touched

  Rule: recording is bounded so a retrying agent cannot be expensive

    An agent retries its exporter every few seconds. The gate is a Redis
    claim keyed on the lookup id carried in the token itself, so a rejected
    request costs one SET NX EX and the database is touched at most once per
    key per day. The record is two nullable columns on the user, so nothing
    accumulates.

    @integration
    Scenario: Repeated attempts with the same key record once a day
      Given a revoked personal ingestion key
      When the agent posts OTLP traces with that key twice in a row
      Then only the first attempt is recorded
      And the second reports that it was deduplicated

  Rule: the notice is visible until dismissed, and returns if it happens again

    @unit
    Scenario: The notice shows while the last rejection is newer than the last dismissal
      Given the user was stamped with a rejection
      And the user has never dismissed the notice
      Then the notice is shown

    @unit
    Scenario: Dismissing hides the notice
      Given the user dismissed the notice after the last rejection
      Then the notice is not shown

    @unit
    Scenario: A fresh rejection after a dismissal brings the notice back
      Given the user dismissed the notice
      And a later rejection stamped the user again
      Then the notice is shown

    @unit
    Scenario: A user who never had a rejection never sees the notice
      Given the user has no recorded rejection
      Then the notice is not shown

  Rule: the notice says what broke and what to do, in one sentence

    @unit
    Scenario: The notice says what broke and how to fix it
      When the notice renders
      Then it says the coding agent's session is no longer valid
      And it names `langwatch login --device` as the fix

    @unit
    Scenario: The notice can be dismissed
      When the user clicks the close button
      Then the dismissal is persisted for that user
