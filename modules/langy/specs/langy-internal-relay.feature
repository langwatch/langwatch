Feature: The Langy relay takes the worker's frame stream
  As the operator of a LangWatch deployment
  I want the worker's per-turn frame stream accepted and authenticated
  So that a turn's live edge reaches the browser and no tenant's token is handed to another

  The worker pushes one ndjson stream per turn to `/api/internal/langy/relay/frames`,
  behind the deployment's shared bearer. Each frame is signed with the turn's run
  token; the relay reads that token from the turn's handoff first, and the handoff
  only answers for the project it was parked under, because conversation ids are
  unique per project, not across the deployment.

  Rule: The stream is answered with a tally

    @unit
    Scenario: An empty frame stream answers a zero tally
      Given a process that composes Langy over its live buffer
      When the worker opens a frame stream and closes it without sending a frame
      Then the relay answers 200 with nothing applied, duplicated or rejected
      And the turn is not reported terminal

  Rule: A frame is authenticated against its own project's handoff

    @unit
    Scenario: A frame signed with its own project's handoff token is applied
      Given a turn's handoff parked under the frame's own project
      When a frame signed with the handoff's run token arrives
      Then the frame is applied to the turn's live buffer

    @unit
    Scenario: A frame whose handoff belongs to another project is rejected
      Given a turn's handoff parked under another project
      When a frame claiming the same conversation and turn arrives for a different project
      Then the frame is rejected as carrying no run token
      And nothing reaches the live buffer
