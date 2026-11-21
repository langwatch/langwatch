Feature: The app's product mail goes through Customer.io on LangWatch Cloud

  On LangWatch Cloud a fixed list of product messages leaves through Customer.io's
  transactional API instead of the install's own mailer, ten in all: invitation re-requests,
  the five join-request messages, automatic domain joins, seat requests, and usage and
  automation limits. Each message is still rendered here; Customer.io only delivers it. A
  message whose HTML carries a per-recipient token, a one-click action link or customer
  content stays on the own mailer, so none of that reaches Customer.io.

  Nurturing alone talks to Customer.io, so notification keeps the routing list and the
  fallback and asks nurturing to hand each message over. Nurturing holds the App API key
  and answers "queued", "refused" or "off".

  Customer.io is an extra hop, never a single point of failure: any send it does not
  accept goes through the own mailer for that recipient. A self-hosted install has no
  Customer.io key and no IS_SAAS, so its mail path does not change at all.

  Background:
    Given a deployment whose own mailer is configured

  @unit
  Scenario Outline: A routed template goes through Customer.io on Cloud
    Given IS_SAAS is set and nurturing holds CUSTOMER_IO_APP_API_KEY
    When a "<template>" message is sent to one recipient
    Then nurturing is handed exactly one message naming "<template>", with our subject and HTML
    And the own mailer sends nothing

    Examples:
      | template              |
      | invite-re-request     |
      | join-request-arrived  |
      | join-request-reminder |
      | join-request-approved |
      | join-request-rejected |
      | join-request-expired  |
      | domain-auto-joined    |
      | seat-request          |
      | usage-limit           |
      | automation-limit      |

  @unit
  Scenario: Every other message stays on the own mailer on Cloud
    Given IS_SAAS is set and nurturing holds CUSTOMER_IO_APP_API_KEY
    When a message of any template off the list, or with no template, or with an attachment, is sent
    Then nothing reaches Customer.io
    And the own mailer sends it

  @unit
  Scenario: Without IS_SAAS or the key nothing reaches Customer.io
    Given IS_SAAS is unset, or nurturing holds no CUSTOMER_IO_APP_API_KEY
    When a "usage-limit" message is sent
    Then nothing reaches Customer.io
    And the own mailer sends it, with no warning
    And a message to several recipients leaves as one envelope under the caller's key, as before

  @unit
  Scenario Outline: A failed usage-limit send still reaches the person
    Given Customer.io answers a "usage-limit" send with <failure>
    When the message is sent
    Then the own mailer sends it once, with the same subject and HTML
    And one warning names the "usage-limit" template

    Examples:
      | failure         |
      | a 500           |
      | a 400           |
      | a 429           |
      | a timeout       |
      | a network error |

  @unit
  Scenario: Only the recipient Customer.io refused falls back
    Given a routed message to two recipients
    And Customer.io refuses the send to one of them
    When the message is sent
    Then the own mailer sends to that recipient only

  @unit
  Scenario: A replyless routed message reaches the real recipient and answers to no-reply
    Given a replyless routed message
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
    Then the routing list holds exactly the ten agreed template ids
    And no security message is on it
    And every id on it is a template the app sends

  @unit
  Scenario Outline: A message carrying a token or customer content stays on the own mailer
    Given IS_SAAS is set and nurturing holds CUSTOMER_IO_APP_API_KEY
    When a "<template>" message is sent
    Then nothing reaches Customer.io
    And the own mailer sends it

    Examples:
      | template                |
      | trigger-digest          |
      | budget-increase-request |

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
  Scenario: Nurturing answers whether Customer.io took the message
    Given nurturing with, or without, CUSTOMER_IO_APP_API_KEY
    When it is handed a message
    Then it answers "queued" with the delivery id when Customer.io gave one, "refused" with the reason and status, or "off"

  @unit
  Scenario: A user's address is filed under their user id
    Given nurturing holds CUSTOMER_IO_APP_API_KEY
    And the recipient's address belongs to a LangWatch user
    When nurturing is handed a message to that address
    Then Customer.io is handed the user id as the only identifier, and no address identifier

  @unit
  Scenario: An address with no user is filed under the address
    Given nurturing holds CUSTOMER_IO_APP_API_KEY
    And the recipient's address belongs to no LangWatch user
    When nurturing is handed a message to that address
    Then Customer.io is handed the address as the identifier

  @unit
  Scenario: A failed user lookup still sends by address
    Given nurturing holds CUSTOMER_IO_APP_API_KEY
    And the user lookup throws
    When nurturing is handed a message
    Then it answers "queued"
    And Customer.io is handed the address as the identifier

  @unit
  Scenario: A stalled user lookup sends by address once the lookup deadline passes
    Given nurturing holds CUSTOMER_IO_APP_API_KEY
    And the user lookup never answers
    When nurturing is handed a message and the lookup deadline passes
    Then it answers "queued"
    And Customer.io is handed the address as the identifier

  @unit
  Scenario: The HTTP client sends the documented request
    When the client sends one message
    Then it posts JSON to the EU /v1/send/email (US when CUSTOMER_IO_REGION is "us") with the key as bearer
    And link tracking is off and unsubscribed people still get it
    And it gives up after ten seconds

  @unit
  Scenario: Liquid openers in the subject and body are printed literally
    Given a message whose subject and body hold "{{" and "{%"
    When the client sends it
    Then every Liquid opener is posted as a Liquid string literal
    And Liquid renders the posted subject and body back to the text as written

  @unit
  Scenario: An accepted send with no readable delivery id still counts as taken
    Given Customer.io answers a "usage-limit" send with a 2xx whose reply holds no delivery id
    When the client sends it
    Then it reports the send taken, with no delivery id, rather than refused
    And one log line names the template, a hash of the recipient and the status
    And that line carries neither the recipient address nor the key
