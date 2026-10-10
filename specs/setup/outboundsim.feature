Feature: outboundsim, a local stand-in for Slack, webhook receivers and SQS
  The product sends messages to things it does not own: Slack incoming webhooks
  and the Slack Web API, customer webhook endpoints (signed, retried) and
  customer SQS queues. outboundsim accepts those calls, records each one
  (channel, target, headers with credentials redacted, body, signature verdict,
  the answer it gave, received time) and keeps them in memory, so a developer,
  an agent, apidiff and visualdiff can read what was sent. It answers in each
  vendor's own shape and can be told to fail, stall or drop. It checks no
  credential: it is a dev shim. haven runs it from the bundled simulator binary.

  # Design: .claude/tmp/handoffs/outboundsim-design.md. To be bound by Go tests in
  # services/outboundsim, tools/thuishaven/domain/overlay_outbound_test.go,
  # tools/thuishaven/cmd/sim_outbound_test.go and apps/outboundsim-web.

  Rule: Slack incoming webhooks

    @unit
    Scenario: A Slack incoming-webhook post becomes a record
      Given outboundsim is running
      When the product posts a message to /services/T0SIM/B0SIGNUPS/x
      Then outboundsim answers 200 with the body "ok"
      And a slack-webhook record holds the target, the text and the blocks

    @unit
    Scenario: A Slack webhook post that is not JSON is refused as Slack refuses it
      When a client posts a body that is not JSON to a /services/ path
      Then outboundsim answers 400 with the body "invalid_payload"
      And the record keeps the raw body and the answer

  Rule: Slack Web API

    @unit
    Scenario: chat.postMessage with a bot token is recorded and answered
      Given outboundsim is running
      When the product posts to /api/chat.postMessage with a bearer token, a channel and text
      Then outboundsim answers 200 with ok true, the channel and a message timestamp
      And a slack-api record holds the method, the channel and the text, with the token redacted

    @unit
    Scenario: conversations.list and auth.test answer from the seeded workspace
      Given the seeded Slack workspace with its channels
      When the product calls /api/conversations.list and /api/auth.test with a bearer token
      Then it gets the seeded channels and the seeded team

    @unit
    Scenario: A Web API call without a token fails as Slack fails it
      When a client posts to /api/chat.postMessage with no Authorization header
      Then outboundsim answers 200 with ok false and error "not_authed"

    @unit
    Scenario: A post to an unknown channel fails as Slack fails it
      When the product posts to /api/chat.postMessage naming a channel the workspace does not have
      Then outboundsim answers 200 with ok false and error "channel_not_found"

    @unit
    Scenario: An unknown Web API method is refused
      When a client posts to /api/users.admin.invite
      Then outboundsim answers 200 with ok false and error "unknown_method"
      And the record names the method

  Rule: Webhook receivers

    @unit
    Scenario: A webhook delivery becomes a record with its LangWatch headers
      Given outboundsim is running
      When the webhook module delivers to /hooks/ok
      Then outboundsim answers 200
      And a webhook record holds the event id, delivery id, attempt and test-fire headers and the body

    @unit
    Scenario: A registered secret verifies the delivery signature
      Given the receiver "ok" is registered with the endpoint's signing secret
      When the webhook module delivers to /hooks/ok
      Then the record's signature verdict is "valid"

    @unit
    Scenario: A wrong or missing signature is recorded, not refused
      Given the receiver "ok" is registered with a different secret
      When the webhook module delivers to /hooks/ok
      Then outboundsim still answers 200
      And the record's signature verdict is "invalid"
      And a delivery to a receiver with no registered secret has the verdict "unchecked"

    @unit
    Scenario: Retries of one event are grouped
      Given the seeded receiver "flaky" fails the first two attempts of each event id with 503
      When the webhook module delivers one event to /hooks/flaky until it succeeds
      Then the deliveries view shows one event id with three attempts, the first two answered 503

    @unit
    Scenario: A slow receiver outlives the sender's timeout
      Given the seeded receiver "slow" answers after 15 seconds
      When the webhook module delivers to /hooks/slow
      Then the sender gives up first
      And the record shows the request arrived and the answer was never read

    @unit
    Scenario: A redirecting receiver is recorded
      Given the seeded receiver "redirect" answers 302 to another receiver
      When the webhook module delivers to /hooks/redirect
      Then the record shows the 302
      And no record appears at the redirect target

    @unit
    Scenario: A body over the cap is truncated in the record
      When a client posts a body larger than the record cap to /hooks/ok
      Then outboundsim answers 200
      And the record keeps the first part of the body and says it was truncated

  Rule: SQS

    @unit
    Scenario: An SQS SendMessage becomes a record
      Given outboundsim is running
      When the webhook module sends a message with the AWS JSON protocol and X-Amz-Target AmazonSQS.SendMessage
      Then outboundsim answers with a MessageId and the MD5 of the body
      And an sqs record holds the queue URL, the body and the message attributes

    @unit
    Scenario: An SQS action outboundsim does not speak is refused in AWS's shape
      When a client sends X-Amz-Target AmazonSQS.ReceiveMessage
      Then outboundsim answers 400 with the AWS error type "UnsupportedOperation"
      And the record names the action

    @unit
    Scenario: An SQS call in the query protocol is refused
      When a client posts form data with Action=SendMessage
      Then outboundsim answers 400 with the AWS error type "InvalidAction"

  Rule: Faults

    @unit
    Scenario: A fault answers a chosen status for a channel and target
      Given a fault for channel webhook, target "ok", status 500
      When the webhook module delivers to /hooks/ok
      Then outboundsim answers 500
      And the record names the fault that answered it

    @unit
    Scenario: A fault adds latency
      Given a fault for channel slack-api, latency 2000 milliseconds
      When the product calls /api/chat.postMessage
      Then the answer arrives no sooner than 2 seconds later

    @unit
    Scenario: A fault drops the connection
      Given a fault for channel sqs, drop true
      When the webhook module sends an SQS message
      Then outboundsim closes the connection without answering
      And the record says it was dropped

    @unit
    Scenario: A fault limited to a number of calls clears itself
      Given a fault for channel slack-webhook, status 429, retry-after 1, times 2
      When the product posts three Slack webhook messages
      Then the first two are answered 429 with Retry-After 1 and the third 200
      And the fault list is empty

    @unit
    Scenario: An invalid fault is refused
      When a client posts a fault with status 99 or a negative latency to /_sim/api/faults
      Then outboundsim answers 422 naming the field
      And the fault list is unchanged

    @unit
    Scenario: Faults can be listed and cleared
      Given two faults
      When a client lists /_sim/api/faults and deletes one by id
      Then one fault remains
      And DELETE /_sim/api/faults clears the rest

  Rule: Control API and console

    @unit
    Scenario: The records can be listed, filtered and cleared
      Given records from every channel
      When a reader lists /_sim/api/records with channel, target, event id or since
      Then it gets the matching records newest first
      And DELETE /_sim/api/records forgets them all

    @unit
    Scenario: The record store is bounded
      Given outboundsim has kept as many records as its cap
      When one more call arrives
      Then the oldest record is forgotten

    @unimplemented
    Scenario: The console shows records, deliveries, faults and setup
      Given records from every channel
      When the console is open
      Then it lists records newest first, filterable by channel, with headers, body and signature verdict
      And it groups webhook deliveries by event id with their attempts
      And it lists, adds and removes faults
      And it shows the URLs to paste into the product for each receiver, Slack webhook and queue

  Rule: haven

    @unimplemented
    Scenario: haven runs outboundsim only when the worktree asks for it
      Given a worktree that has never been up
      When the developer runs "haven up"
      Then no outbound lane runs
      When the developer runs "haven up +outbound"
      Then an outbound lane runs the bundled outboundsim, routed at outbound.<slug>.langwatch.localhost
      And the overlay points the internal Slack webhook settings at it and admits local webhook URLs

    @unimplemented
    Scenario: A developer's own Slack and webhook settings win
      Given the worktree's environment already names SLACK_CHANNEL_SIGNUPS
      When the developer runs "haven up +outbound"
      Then the overlay leaves that setting alone

    @unit
    Scenario: The overlay points the product's Slack addresses at outboundsim
      Given the worktree's environment names neither SLACK_API_BASE nor SLACK_WEBHOOK_BASE
      When the developer runs "haven up +outbound"
      Then the overlay points SLACK_API_BASE at outboundsim's /api and SLACK_WEBHOOK_BASE at its origin
      And a token check or webhook test fire from the product lands in outboundsim, not at Slack
      And an address .env names is left alone

    @unimplemented
    Scenario: The agent CLI reads and waits on records
      Given an outbound lane is running
      When an agent runs "haven sim outbound list --channel webhook --json"
      Then it gets the records as JSON
      When an agent runs "haven sim outbound wait --channel slack-webhook --timeout 10s"
      Then it returns the first matching record, or exits non-zero naming the timeout

    @unimplemented
    Scenario: The agent CLI sets and clears faults
      When an agent runs "haven sim outbound fault add --channel webhook --target ok --status 503 --times 1 --json"
      Then the fault is listed by "haven sim outbound fault list --json"
      And "haven sim outbound fault clear" removes it

    @unimplemented
    Scenario: The agent CLI refuses when no outbound lane runs
      Given the stack runs without +outbound
      When an agent runs "haven sim outbound list"
      Then haven exits non-zero and says to run "haven up +outbound"
