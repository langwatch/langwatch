Feature: The background worker owns automation settlement

  The automations pipeline was the last of the four the worker mounted from a
  definition the application handed it. The definition itself was already the
  feature's own; what was not the feature's own was the settlement executor
  behind it, which named three whole capability services to reach ten methods,
  one method and four methods. Those are three narrow ports now, so the worker
  composes them over its own Postgres client and its own ClickHouse.

  What the worker still cannot do about a settled match it says by name, once,
  at composition — because a settlement half that quietly did four fifths of the
  job would look identical from outside to one that did all of it.

  Background:
    Given a background worker composed from its own database, ClickHouse and mail

  @unit
  Scenario: The worker mounts every automation routing key
    When the composition root builds the automations pipeline
    Then it registers every routing key the frozen job registry lists for it
    And it registers no routing key the registry does not list
    And the graph-alert sweep and the webhook delivery prune wake on their own
      schedules while registering no routing key at all

  @unit
  Scenario: A settled match reaches its recipients from this process
    Given an active email automation with no template of its author's own
    When a settled window is notified through the pipeline's own intent handler
    Then the digest is rendered from this deployment's own host and sent
    And the send is claimed per recipient and per trace before the window closes
    And the automation is stamped as having run

  @unit
  Scenario: The settlement digest renders and sends from this process
    Given an automation whose author wrote no subject or body
    When the digest is delivered
    Then the recipient receives the no-reply envelope the application sends
    And the unsubscribe footer offers both the automation and the whole project

  @unit
  Scenario: A settlement half that cannot deliver says so
    Given a deployment that named no host for its links
    When the composition root builds the automations pipeline
    Then it reports that it composed no outbound delivery
    And it reports every other capability it does not have, by name

  @unit
  Scenario: A trace whose full record this process cannot read still notifies
    Given a settled match whose fold state is present
    And a process that composes no full-record trace read
    When the digest is built
    Then the notification is sent from the fold state alone
    And the record's absence is reported as unavailable rather than as missing
