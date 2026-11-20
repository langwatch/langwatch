Feature: The app's product mail goes through Customer.io on LangWatch Cloud

  On LangWatch Cloud a fixed list of product messages leaves through Customer.io's
  transactional API instead of the install's own mailer: invitation re-requests, the
  join-request messages, seat and budget requests, usage and automation limits, payment
  recovery, the trigger digest and the paused online evaluation. Each message is still
  rendered here; Customer.io only delivers it.

  Customer.io is an extra hop, never a single point of failure: any send it does not
  accept goes through the own mailer for that recipient. A self-hosted install has no
  Customer.io key and no IS_SAAS, so its mail path does not change at all.

  Background:
    Given a deployment whose own mailer is configured

  @unit
  Scenario Outline: A routed template goes through Customer.io on Cloud
    Given IS_SAAS is set and CUSTOMER_IO_APP_API_KEY is present
    When a "<template>" message is sent to one recipient
    Then exactly one request reaches Customer.io's EU transactional endpoint with the key as bearer
    And it names "<template>" as the transactional message, with our subject and HTML
    And link tracking is off
    And the own mailer sends nothing

    Examples:
      | template                |
      | invite-re-request       |
      | join-request-arrived    |
      | join-request-reminder   |
      | join-request-approved   |
      | join-request-rejected   |
      | join-request-expired    |
      | domain-auto-joined      |
      | seat-request            |
      | usage-limit             |
      | payment-recovery        |
      | budget-increase-request |
      | automation-limit        |
      | trigger-digest          |
      | monitor-auto-paused     |

  @unit
  Scenario: Every other message stays on the own mailer on Cloud
    Given IS_SAAS is set and CUSTOMER_IO_APP_API_KEY is present
    When a message of any template off the list, or with no template, is sent
    Then nothing reaches Customer.io
    And the own mailer sends it

  @unit
  Scenario: Without IS_SAAS or the key nothing reaches Customer.io
    Given IS_SAAS is unset, or CUSTOMER_IO_APP_API_KEY is missing
    When a "payment-recovery" message is sent
    Then nothing reaches Customer.io
    And the own mailer sends it

  @unit
  Scenario Outline: A failed payment-recovery send still reaches the person
    Given Customer.io answers a "payment-recovery" send with <failure>
    When the message is sent
    Then the own mailer sends it once, with the same subject and HTML
    And one warning names the "payment-recovery" template

    Examples:
      | failure             |
      | a 500               |
      | a 400               |
      | a 429               |
      | a timeout           |
      | a network error     |

  @unit
  Scenario: Only the recipient Customer.io refused falls back
    Given a routed message to two recipients
    And Customer.io refuses the send to one of them
    When the message is sent
    Then the own mailer sends to that recipient only

  @unit
  Scenario: A replyless digest reaches the real recipient and answers to no-reply
    Given a replyless "trigger-digest" message
    When it is sent through Customer.io
    Then Customer.io is handed the real recipient as the person and the address
    And the reply-to is the no-reply address

  @unit
  Scenario: When both Customer.io and the own mailer fail the send fails with the own mailer's error
    Given Customer.io refuses a routed send
    And the own mailer fails too
    When the message is sent
    Then the send rejects with the own mailer's error

  @unit
  Scenario: The routing list holds the agreed product messages and no security mail
    Then the routing list holds exactly the fourteen agreed template ids
    And no security message is on it
    And every id on it is a template the app sends

  @unit
  Scenario: No log line carries the key or a recipient address
    When routed sends succeed, and fail and fall back
    Then no log line contains the Customer.io key or any recipient address

  @unit
  Scenario: The unsubscribe pair, the reply-to and hidden recipients reach Customer.io
    Given a routed message with an unsubscribe link and a hidden recipient
    When it is sent through Customer.io
    Then every recipient gets its own request
    And each carries the List-Unsubscribe pair and the reply-to

  @unit
  Scenario: The HTTP client sends the documented request
    When the client sends one message
    Then it posts JSON to the regional /v1/send/email with the key as bearer
    And it gives up after ten seconds
