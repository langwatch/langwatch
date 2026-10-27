Feature: The envelope a graph alert leaves a background process in

  An automation email is not addressed to its recipients. They ride in BCC
  behind a hashed no-reply, so no reader learns who else was told, a reply-all
  reaches a bounce handler rather than the list, and the only string
  interpolated into the `To` header is one we built. On top of the customer's
  own template goes an unsubscribe footer they cannot strip, and the one-click
  headers a mail client shows as an Unsubscribe button.

  All of that is a deployment's convention rather than the feature's, which is
  why it lives in the process that sends. But a second process now sends the
  same automation's mail, and a recipient cannot tell which one wrote to them —
  so the envelope is pinned to the application's, byte for byte, while both
  exist.

  Two channels this port declares are deliberately absent here. The settlement
  digest's two legacy renderers belong to a pipeline this process does not run,
  and a customer-supplied webhook URL needs an egress fence this process does
  not yet own. Both refuse by name: a graph that grows either one fails at the
  first send rather than reporting success and delivering nothing.

  @unit
  Scenario: Recipients ride in BCC behind a no-reply
    Given a composed alert delivery adapter
    When an alert is sent to a recipient
    Then the address in the To header is the automation's own no-reply
    And the recipient is delivered as BCC

  @unit
  Scenario: The footer and its one-click headers are the application's
    Given a composed alert delivery adapter
    When an alert is sent to a recipient
    Then the message carries the same unsubscribe footer the application appends
    And it carries the same one-click headers

  @unit
  Scenario: A newline in the subject never becomes a header
    Given a composed alert delivery adapter
    When an alert whose subject contains a line break is sent
    Then the subject reaches the gateway on one line

  @unit
  Scenario: A malformed recipient is skipped rather than sent to
    Given a composed alert delivery adapter
    When an alert names a recipient that is not an address
    Then nothing is sent to it
    And the skipped address is not written to the log

  @unit
  Scenario: A recipient already written to is not written to again
    Given a composed alert delivery adapter
    And one recipient was delivered on an earlier attempt
    When the alert is redelivered
    Then only the remaining recipient is sent to
    And the recipient is recorded by a hash rather than by address

  @unit
  Scenario: A channel this process cannot send through refuses by name
    Given a composed alert delivery adapter with no webhook transport
    When a webhook alert is dispatched
    Then it is refused naming what the process is missing
    And the settlement digest's two legacy renderers refuse the same way
