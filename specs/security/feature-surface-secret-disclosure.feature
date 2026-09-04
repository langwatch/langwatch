Feature: Feature API surfaces never hand back a secret or an internal detail
  As a customer of a LangWatch deployment
  I want the credentials I typed to stay out of durable tables and out of read
  responses, and a server failure to tell me nothing about the machine it
  happened on
  So that an audit reader, a view-only member and an unhandled exception are
  not three routes to the same key.

  From the 2026-09-04 security pass over the feature API surfaces (findings H2,
  M5, M6, M11, M12).

  Rule: the audit trail keeps the field name, never the credential

    The scalar redaction registry named `secrets.create` and `secrets.update`
    and nothing else, so `license.generate` wrote the licence signing private
    key verbatim into a queryable table. The registry could never be complete;
    a field-name rule that runs for every action is what closes the class.

    @unit
    Scenario: The licence signing private key is never persisted to the audit trail
      Given a licence generation mutation carrying a signing private key
      When its arguments are recorded in the audit trail
      Then the private key is not in the recorded arguments
      And the organization name and plan the run chose are kept

    @unit
    Scenario: An uploaded licence key is never persisted to the audit trail
      Given a licence upload mutation carrying a licence key
      When its arguments are recorded in the audit trail
      Then the licence key is not in the recorded arguments

    @unit
    Scenario: A credential-named field is redacted on a mutation nobody listed
      Given a mutation whose input carries a field named for a credential
      When its arguments are recorded in the audit trail
      Then that field's value is not in the recorded arguments

    @unit
    Scenario: A credential nested inside an input object is redacted too
      Given a mutation whose input nests a credential-named field in an object
      When its arguments are recorded in the audit trail
      Then the nested value is not in the recorded arguments

    @unit
    Scenario: A token count is not mistaken for a credential
      Given a mutation whose input carries token counts and no credential
      When its arguments are recorded in the audit trail
      Then the arguments are recorded unchanged

  Rule: a stored destination secret does not travel to a reader

    An anomaly rule's `destinationConfig` carries the shared secret that signs
    outbound SIEM alerts. Read paths returned it in full, so a view-only member
    could forge alerts into the customer's SIEM. Writes still accept it.

    @unit
    Scenario: Reading an anomaly rule reports that a shared secret is set, not what it is
      Given an anomaly rule whose destination carries a shared secret
      When the rule is serialised for a reader
      Then the shared secret is not in the serialised rule
      And the destination carries a redacted marker in its place
      And the rest of the destination is unchanged

    @unit
    Scenario: An edit that sends the marker back keeps the stored shared secret
      Given an anomaly rule whose destination carries a shared secret
      When an admin saves the rule with the marker still in place
      Then the stored shared secret is unchanged

    @unit
    Scenario: A marker sent for a destination we hold no secret for is refused
      Given an anomaly rule whose destination carries no shared secret
      When an admin saves a destination carrying only the marker
      Then the save is refused as a validation error

  Rule: one graph read redacts what the graph list redacts

    `graphs.getById` hand-picked fields off the raw trigger and returned the
    Slack incoming-webhook URL — a bearer credential — where the list routes
    the same parameters through the redaction port.

    @unit
    Scenario: A graph read returns no Slack webhook URL
      Given a graph whose alert posts to a Slack incoming webhook
      When the graph is read by id
      Then the webhook URL is not in the response
      And the alert still reports its threshold, operator and series

  Rule: a failed request returns a generic message and a trace id

    Fourteen handlers put a caught error's own message — a driver diagnostic
    naming a host, a port or a database — into a 500 body. ADR-045 makes the
    unknown outcome generic on purpose.

    @integration
    Scenario: An annotation read failure returns no driver diagnostic
      Given the annotation store fails with a message naming the database host
      When a customer reads annotations over REST
      Then the response body does not carry the store's own message
      And the body is the generic refusal this family has always published

    @integration
    Scenario: A legacy evaluation batch failure returns no driver diagnostic
      Given the evaluation batch write fails with a message naming the database host
      When a customer posts evaluation batch results
      Then the response body does not carry the store's own message

    @unit
    Scenario: A workflow evaluation failure returns no server stack trace
      Given a workflow evaluation fails with an error carrying a stack trace
      When the failure is mapped for the caller
      Then no absolute server path is in the mapped failure

  Rule: an internal service address is a log line, not a client contract

    The evaluator adapter put the address it dialled into `HandledError.meta`,
    which serialises onto the experiment SSE stream.

    @unit
    Scenario: An evaluator timeout names the evaluator, not the address dialled
      Given the evaluator service does not answer before the timeout
      When the failure reaches the caller
      Then the error names the evaluator type and the timeout
      And the address dialled is not on the error

    @unit
    Scenario: An unreachable evaluator names the evaluator, not the address dialled
      Given the evaluator service cannot be reached
      When the failure reaches the caller
      Then the error names the evaluator type
      And the address dialled is not on the error
