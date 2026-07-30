Feature: A tool call's identity is an identity, not a provider payload
  As a LangWatch user chatting with Langy
  I want the id of a tool call to be just its id
  So that a model provider's round-trip data does not ride along in everything we store

  # Some model providers require an opaque blob to be handed back on the next
  # request — Gemini's thought signature is the one we hit. The agent runtime
  # has nowhere to put it, so it staples it onto the tool call's id:
  #
  #   <real id>_ts_<base64url blob>
  #
  # That is not an identifier. It is kilobytes of provider payload wearing an
  # identifier's clothes, and Langy treated it as identity: it went into the
  # durable event data, into the message parts, and — because the tool
  # commands compose their idempotency key out of it — into the process
  # manager's inbox key, where it was long enough to break the database index
  # and wedge the conversation for good
  # (specs/event-sourcing/process-manager-inbox-key.feature).
  #
  # So the relay strips the round-trip suffix where the frame enters, before
  # anything is stored or paired. What is left is the id the provider actually
  # issued, which is what every downstream consumer wanted in the first place.
  #
  # Stripping happens at the wire boundary rather than at each use, because
  # start and end frames, live cards, durable events and the final's tool list
  # all read the same field — normalising once is the only way they agree.

  Background:
    Given I am signed in to LangWatch on a project
    And I have opened the Langy panel

  Rule: A provider's round-trip blob is stripped from a tool call id

    @unit
    Scenario: A tool id carrying a thought signature is reduced to the real id
      When the agent reports a tool call whose id carries a provider signature
      Then the tool call is recorded under the id the provider issued
      And the signature is not stored anywhere on the tool call

    @unit
    Scenario: A start and an end frame for the same call still pair up
      When the agent reports the start and the end of a tool call carrying a provider signature
      Then both frames resolve to the same tool call id

    @unit
    Scenario: An ordinary tool id is left exactly as it is
      When the agent reports a tool call with a plain id
      Then the id is recorded unchanged

    @unit
    Scenario: A separator inside a normal id is not mistaken for a signature
      When the agent reports a tool call whose id contains the separator but no signature
      Then the id is recorded unchanged

    @unit
    Scenario: A tool call listed on the final answer is normalised the same way
      When the agent's final answer lists a tool call whose id carries a provider signature
      Then that tool call is recorded under the id the provider issued

  Rule: An id that is still implausible after stripping is rejected, not stored

    @unit
    Scenario: An absurdly long id is refused as an invalid frame
      When the agent reports a tool call whose id is longer than any real id
      Then the frame is rejected as invalid
      And nothing is recorded for it

  Rule: The idempotency of a tool call follows its normalised id

    @unit
    Scenario: A tool call's durable key is built from the normalised id
      Given a tool call whose id carried a provider signature
      When its start is recorded as a durable milestone
      Then the event's idempotency key contains the normalised id only
