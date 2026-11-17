Feature: Composing the graph-alert vertical outside the application

  Trace's real-time subscriber asks Automation two questions on every trace
  that lands: which of this project's automations watch a custom graph, and
  what happens if one is re-evaluated now. Those two calls used to name the
  whole `AutomationService`, so a process that wanted them had to compose
  report schedules, template test fires and the persist-cap ledger as well —
  and Automation could not be composed anywhere Trace was not, because the
  service it needed lived on the other side of the pipeline it feeds.

  Narrowing the two calls to a port is what breaks the cycle. The published
  service still satisfies it, so the application keeps passing what it always
  passed; a background process composes the graph half alone.

  What that half needs from a process is a database, a clock, the two
  capability services it reads through, the outbound transports, and the
  cipher its stored credentials were written under. Nothing in it reads an
  environment, so it composes in a test with no environment at all.

  @unit
  Scenario: The two questions the real-time path asks are the whole port
    Given a composed graph-alert vertical
    When the trace subscriber asks for a project's graph automations
    Then it receives only automations that watch a custom graph
    And a report automation is never among them

  @unit
  Scenario: One read serves both halves of a trace's arrival
    Given a composed graph-alert vertical
    When the same project is asked for its automations twice inside the window
    Then the database is read once

  @unit
  Scenario: A firing automation reaches the channel its author chose
    Given a composed graph-alert vertical whose automation has crossed its threshold
    When the trace subscriber evaluates it
    Then the alert is delivered through that automation's own channel
    And the recipient is recorded so a redelivery does not send twice

  @unit
  Scenario: A suppressed recipient is not written to
    Given a composed graph-alert vertical whose automation has crossed its threshold
    And the only recipient has unsubscribed
    When the trace subscriber evaluates it
    Then no message is sent

  @unit
  Scenario: The vertical composes from a database and transports alone
    Given no environment variables at all
    When a process composes the graph-alert vertical
    Then composition succeeds

  @unit
  Scenario: A stored Slack credential is read back with the deployment's own key
    Given an automation whose Slack bot token this deployment encrypted
    When the trace subscriber evaluates it
    Then the Slack call carries the token in plaintext
    And it names the channel the author chose

  @unit
  Scenario: A process holding no credentials key refuses rather than sending a ciphertext
    Given an automation whose Slack bot token this deployment encrypted
    And a process configured with no credentials key
    When the trace subscriber evaluates it
    Then the alert is refused naming the setting the operator must supply
    And nothing is sent to Slack

  @unit
  Scenario: A webhook secret sealed by an earlier release opens through the live trigger repository
    Given a webhook automation whose headers and signing secret an earlier release sealed with this deployment's key
    When the live trigger repository reads the row and the delivery opens them
    Then the headers and the signing secret are in plaintext

  @unit
  Scenario: What the live trigger repository seals, an earlier release opens
    Given a secret the live trigger repository sealed
    When the deployment's cipher opens it as an earlier release did
    Then it is the secret unchanged
    And the stored value is not the secret

  @unit
  Scenario: One trigger's failure does not starve the rest
    Given a project with several graph automations
    And evaluating one of them fails
    When the trace subscriber runs
    Then every other automation is still evaluated
    And the sweep reports failure so the queue redelivers it

  @unit
  Scenario: A webhook receiver's terminal refusal is the customer's, not ours
    Given a graph automation whose own webhook receiver answers 404
    When the trace subscriber runs
    Then it warns with the trigger and the status, never the response body
    And the queue is not asked to redeliver it

  @unit
  Scenario: A webhook receiver that may yet answer is warned about and redelivered
    Given a graph automation whose own webhook receiver answers 503
    When the trace subscriber runs
    Then it warns with the trigger and the status
    And the queue redelivers it

  @unit
  Scenario: Our own evaluation failure is an error and is redelivered
    Given a graph automation whose evaluation fails inside LangWatch
    When the trace subscriber runs
    Then it logs an error and the queue redelivers it

  @unit
  Scenario: Only failures a retry can help are redelivered
    Given graph automations failing at a 404 receiver, inside LangWatch and at a 503 receiver
    When the trace subscriber runs
    Then every automation is still evaluated
    And only the failures inside LangWatch and at the 503 receiver count toward redelivery

  @unit
  Scenario: The scheduled sweep does not redeliver a terminal webhook receiver refusal
    Given a sweep candidate whose own webhook receiver answers 404
    When the scheduled graph-alert sweep runs
    Then it warns with the trigger and the status, never the response body
    And the sweep does not ask the queue to redeliver it

  @unit
  Scenario: The scheduled sweep redelivers only failures a retry can help
    Given sweep candidates failing at a 503 receiver and inside LangWatch
    When the scheduled graph-alert sweep runs
    Then every candidate is still evaluated
    And the sweep reports failure for both so the queue redelivers it

  @unit
  Scenario: With a public origin, a graph alert's email leaves through notification
    Given a process that names its public origin
    When a crossed graph alert is dispatched to one email recipient
    Then one message leaves through notification, addressed to that recipient

  @unit
  Scenario: Without a public origin, graph alerts refuse by name
    Given a process that names no public origin
    When a crossed graph alert is dispatched
    Then it refuses with the service-unavailable code
