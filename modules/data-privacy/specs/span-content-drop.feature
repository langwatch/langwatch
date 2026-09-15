Feature: Dropping span content a project asked never to store

  A project can set a content category — input, output, system instructions,
  tool calls — to `drop`, or write custom attribute rules. The drop runs at
  ingestion, before the event is made immutable, and it is the only chance:
  nothing downstream can take back a value that was written.

  Two markers are the only evidence the pass ran, because the original span is
  never stored. Their attribute names are therefore a wire format between the
  process that wrote the span and every reader of it.

  @unit
  Scenario: The drop catalog is pinned key for key
    Given the built-in content key catalog
    When a category is dropped
    Then every key in that category's set is stripped
    And a key missing from the set is content the customer asked to remove and that was stored anyway

  @unit
  Scenario: Every content category has a key set
    Given the four content categories
    When the catalog is read
    Then each category names its keys

  @unit
  Scenario: Metadata keys are never droppable
    Given a project that dropped every content category
    When its spans are stored
    Then tokens, cost, model, latency, ids, names and status survive

  @unit
  Scenario: The chat-array keys are exactly input plus output
    Given a conversation stored under an input or output key
    When a role-based category is dropped
    Then the role strip walks that key

  @unit
  Scenario: The drop markers are a wire format
    Given a span whose content was dropped
    When a reader looks for the evidence
    Then the two marker attribute names and the twenty-key cap are exactly as the read path expects

  @unit
  Scenario: A dropped category removes every key in its set
    Given a policy dropping the input category
    When a span carrying input keys is stripped
    Then those keys are removed and the metadata keys stay

  @unit
  Scenario: The drop marker names the dropped categories in catalog order
    Given a policy dropping more than one category
    When a span is stripped
    Then the marker lists them comma-joined in the catalog's own order

  @unit
  Scenario: A span event's attributes are dropped too
    Given a span whose event carries a dropped key
    When the span is stripped
    Then the event's attribute is removed as well

  @unit
  Scenario: A dropped system category strips system turns from the conversation
    Given a policy dropping system instructions
    When the captured conversation still carries a system turn
    Then the turn is removed, because canonicalisation would otherwise re-derive the attribute from it

  @unit
  Scenario: A dropped tools category strips tool turns and assistant tool_calls
    Given a policy dropping tool calls
    When the captured conversation carries tool turns, function turns and assistant tool_calls
    Then all of them are removed and the other turns are kept

  @unit
  Scenario: A value that is not a conversation is left untouched
    Given a chat-array key whose value is not valid JSON
    When a role-based category is dropped
    Then the value is left exactly as it arrived and nothing throws

  @unit
  Scenario: Custom attribute rules drop by wildcard and name the keys
    Given a custom attribute rule with a wildcard
    When matching attributes are stripped
    Then the second marker lists the dropped key names and never their values

  @unit
  Scenario: The dropped-keys marker is capped
    Given more dropped keys than the cap
    When the marker is stamped
    Then it lists at most twenty of them

  @unit
  Scenario: A restrict rule is not a drop rule
    Given a custom attribute rule set to restrict
    When a span carrying the attribute is stripped
    Then the attribute is kept, because restrict is a read-time rule

  @unit
  Scenario: A policy with no drop leaves the span exactly as it arrived
    Given a policy dropping nothing
    When a span is stripped
    Then no attribute is removed and no marker is stamped

  @unit
  Scenario: The policy is resolved for the ingesting project
    Given a span ingested for a project
    When the drop runs
    Then the project's own resolved policy is the one applied

  @unit
  Scenario: A policy that cannot be resolved fails open
    Given a policy resolution that fails
    When the drop runs
    Then the span keeps its content and the failure is logged
    And the content stays subject to read-time visibility

  @unit
  Scenario: With enforcement off nothing is dropped and no policy is read
    Given native policy enforcement is off
    When the drop runs
    Then no policy is resolved and the span is stored whole

  @unit
  Scenario: The content drop composes from the policy service alone
    Given a process holding a scoped data-privacy service
    When the drop graph is composed
    Then it answers the narrow port the record command names

  @unit
  Scenario: The composed path removes a dropped category's content
    Given the composed drop graph
    When a span is dropped through the port
    Then the content is gone and the marker explains it
