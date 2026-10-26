Feature: The no-preprocess-in-event-schema lint rule
  A stored event payload keeps its shape forever. A payload schema that
  rewrites its input with `z.preprocess` hides a second version of the event
  inside one schema. A changed shape is a new event version, and the
  pipeline's upcast reads the stored version as the current one.

  The rule is name-based and leans to false negatives: it covers every call
  in an events file of a contract or process package, and elsewhere a call
  enclosed by a const or property named for a payload or event data schema.

  Background:
    Given a workspace whose agent module has a contract and a process half

  @unit
  Scenario: z.preprocess in an events file is reported
    Given a contract file named agent.events.ts that calls z.preprocess
    When the no-preprocess-in-event-schema rule runs over it
    Then it reports preprocessInEventSchema on the call

  @unit
  Scenario: The report asks for a version and an upcast
    Given a z.preprocess call in an events file
    When the no-preprocess-in-event-schema rule runs over it
    Then the message asks the author to version the event and add an upcast

  @unit
  Scenario: A payload schema is recognised by its name
    Given a contract file that is not an events file
    And a const named like a payload schema or an event data schema that calls z.preprocess
    When the no-preprocess-in-event-schema rule runs over it
    Then it reports preprocessInEventSchema on each call

  @unit
  Scenario: An events file in a process package is governed too
    Given a process file named agent.events.ts that calls z.preprocess
    When the no-preprocess-in-event-schema rule runs over it
    Then it reports preprocessInEventSchema on the call

  @unit
  Scenario: Preprocess is recognised however zod is imported
    Given an events file that imports z as zod, imports zod as a namespace, or imports preprocess bare
    When the no-preprocess-in-event-schema rule runs over it
    Then it reports preprocessInEventSchema on each preprocess call

  @unit
  Scenario: A preprocess nested in a payload field is reported
    Given a contract file that is not an events file
    And a payload schema object whose field calls z.preprocess
    When the no-preprocess-in-event-schema rule runs over it
    Then it reports preprocessInEventSchema on the nested call

  @unit
  Scenario: Config and input schemas may preprocess
    Given a z.preprocess in a contract const that is no payload schema, and one in a process file that is no events file
    When the no-preprocess-in-event-schema rule runs over them
    Then it reports nothing
