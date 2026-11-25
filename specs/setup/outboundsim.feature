Feature: outboundsim, a local stand-in for Slack, webhook receivers and SQS
  The product sends messages to things it does not own: Slack incoming webhooks
  and the Slack Web API, customer webhook endpoints (signed, retried) and
  customer SQS queues. outboundsim accepts those calls, records each one
  (channel, target, headers with credentials redacted, body, signature verdict,
  the answer it gave, received time) and keeps them in memory, so a developer
  or an agent can read what was sent. It answers in each
  vendor's own shape and can be told to fail, stall or drop. It checks no
  credential: it is a dev shim. haven runs it from the bundled simulator binary.

  # Design: .claude/tmp/handoffs/outboundsim-design.md. To be bound by Go tests in
  # services/sims/outboundsim, tools/thuishaven/domain/overlay_outbound_test.go,
  # tools/thuishaven/cmd/sim_outbound_test.go and apps/sims/src/outbound.

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
    Scenario: A token that says it is invalid or revoked is refused as Slack refuses it
      When a client calls a Web API method with a bearer token containing "invalid" or "revoked"
      Then outboundsim answers 200 with ok false and error "invalid_auth" or "token_revoked"

    @unit
    Scenario: A token that lapsed after connecting passes the check and fails the post
      When a client with a bearer token containing "lapsed" calls auth.test and then chat.postMessage
      Then auth.test answers ok and the post answers error "token_revoked"

    @unit
    Scenario: A post to an archived channel fails as Slack fails it
      When the product posts to /api/chat.postMessage naming the seeded archived channel C0OLD
      Then outboundsim answers 200 with ok false and error "is_archived"

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

  Rule: Governance pull vendors (Databricks Genie and usage feeds)
    # The product's pull sources read these paths; see services/sims/outboundsim/databricks.go.
    # A word in the token (or a service principal's client id) picks the workspace:
    # empty, revoked, noscope, ratelimited, down, malformed or cycle; anything else is the seed.

    @unit
    Scenario: A Genie workspace lists its spaces, conversations and messages to a good token
      Given outboundsim is running
      When a pull source reads /api/2.0/genie/spaces, a space's conversations and a conversation's messages with a bearer token naming no tenant word
      Then outboundsim answers each in Databricks' shape from a seeded workspace of three spaces
      And a second read of a message reports the same message id and timestamp
      And each call is a databricks record with the token redacted

    @unit
    Scenario: Each refusal a pull source names has a credential that triggers it
      When a pull source reads the spaces with no token, or a token holding revoked, noscope, ratelimited or down
      Then outboundsim answers 401, 401, 403, 429 with Retry-After, or 503 in Databricks' error shape
      And a token holding malformed is answered 200 with an HTML sign-in page
      And a token holding empty is answered an empty list, and one holding cycle repeats its page token

    @unit
    Scenario: A scripted fault overrides a good token on one Databricks path
      Given a fault on channel databricks for target /api/2.0/genie/spaces with status 403, once
      When a pull source reads the spaces with a good token twice
      Then the first read is refused 403 and the second is served

    @unit
    Scenario: A service principal signs in and its client id picks the workspace
      When a pull source posts client credentials to /oidc/v1/token
      Then outboundsim answers an access token naming the client id
      And a client id holding revoked is refused 401 invalid_client

    @unit
    Scenario: The SCIM directory pages by startIndex and can be replaced
      When a pull source reads /api/2.0/preview/scim/v2/Users with startIndex and count
      Then outboundsim answers a SCIM list response with the total and that page
      And PUT /_sim/api/databricks/users replaces the directory, refusing a user without an id or userName with 422

    @unit
    Scenario: A usage feed serves events after a cursor for a custom HTTP pull
      When a custom HTTP pull source reads /feeds/<name>?cursor=<n> with a bearer token
      Then outboundsim answers the events after n and next_cursor
      And a token holding revoked is refused 401

    @unit
    Scenario: The overlay points the governance pull vendors at outboundsim
      Given the worktree's environment names none of the five vendor base settings
      When the developer runs "haven up +outbound"
      Then the overlay sets DATABRICKS_WORKSPACE_BASE to outboundsim's origin
      And OPENAI_ADMIN_API_BASE, ANTHROPIC_ADMIN_API_BASE, MICROSOFT_LOGIN_BASE and MICROSOFT_GRAPH_API_BASE to its /openai, /anthropic, /microsoft-login and /microsoft-graph
      And a base .env names is left alone

    @unit
    Scenario: Outboundsim answers the OpenAI, Anthropic and Microsoft calls a pull source makes
      When a pull source reads member lists, the account lookup, a Microsoft token, Graph users or subscribed SKUs
      Then outboundsim answers each from a seeded tenant
      And a key holding revoked, or no credential, is refused 401

    @unit
    Scenario: Outboundsim serves the OpenAI cost report, paged
      When a pull source reads /openai/v1/organization/costs with start_time and group_by[]
      Then outboundsim answers one daily bucket per page with has_more and next_page until the last
      And a key holding nokeys refuses group_by[]=api_key_id with 400 naming start_time
      And a key holding flaky is refused 503 after the first page and revoked is refused 401

    @unit
    Scenario: Outboundsim serves the Anthropic usage and cost reports, paged
      When a pull source reads the usage_report/messages or cost_report routes with starting_at
      Then outboundsim answers one bucket per page with has_more and next_page until the last
      And a key holding cycle repeats the same next_page, and an unreadable starting_at is refused 400

    @unit
    Scenario: Outboundsim serves the Claude compliance audit log and the Microsoft directory audits, paged
      When a custom pull source reads /anthropic/v1/organizations/audit_log or /microsoft-graph/v1.0/auditLogs/directoryAudits
      Then outboundsim answers three events a page with a cursor, or an absolute @odata.nextLink on its own origin
      And a drained cursor answers no events, noscope is refused 403 and down 503

    @unit
    Scenario: Outboundsim serves Dataverse bots and conversation transcripts behind the Microsoft token
      When a Dataverse pull source reads /dataverse/api/data/v9.2/bots and conversationtranscripts
      Then outboundsim answers the agents, and the transcripts ordered by createdon and id three a page through @odata.nextLink
      And it honours the createdon cursor and bot ids in $filter, and refuses a revoked or missing token with 401

  Rule: Codex sign-in and turns (the ChatGPT subscription provider)

    @unit
    Scenario: Outboundsim stands in for Codex device sign-in and model turns
      When the product starts a Codex device sign-in against /codex-auth and polls it
      Then outboundsim answers 403 authorization_pending until the code is approved on its verification page
      And the poll then hands over an authorization code that exchanges for id, access and refresh tokens
      And a model turn on /codex-api/responses streams Responses SSE ending in response.completed

    @unit
    Scenario: Outboundsim's Codex refuses as the control API asks
      Given the control API sets a usage limit, expires the access tokens, revokes refresh or slows polling
      Then a turn is refused 429 usage_limit_reached, or 401 for an expired token
      And a refresh is refused 400 invalid_grant, and a poll answers slow_down, expired_token or access_denied

  Rule: Cloud stand-ins (AWS STS, Azure Blob, Web Push)

    @unit
    Scenario: The overlay points managed Bedrock's STS and Azure Blob storage at outboundsim
      Given the worktree's environment names none of MANAGED_BEDROCK_STS_BASE, AZURE_BLOB_ENDPOINT or AZURE_BLOB_AUTHORITY_HOST
      When the developer runs "haven up +outbound"
      Then the overlay sets MANAGED_BEDROCK_STS_BASE to outboundsim's direct /sts
      And AZURE_BLOB_ENDPOINT to its haven route's /azure-blob/<account>, the account .env names or simaccount
      And a base .env names is left alone

    @unit
    Scenario: Outboundsim answers the STS AssumeRole calls managed Bedrock makes
      When managed Bedrock assumes its proxy role and then the customer role at /sts/
      Then outboundsim answers each SigV4-signed AssumeRole with fresh session credentials as STS XML
      And a role ARN holding denied is refused 403 AccessDenied, and an unsigned call 403 MissingAuthenticationToken

    @unit
    Scenario: Outboundsim holds Azure Blob accounts the object storage writes, reads and deletes
      When object storage probes the container, puts, gets and deletes a blob under /azure-blob/<account> with Shared Key
      Then outboundsim answers 200, 201, 200 with the bytes and 202, and a missing blob 404 BlobNotFound
      And a browser holding a service or user-delegation SAS can upload and read the blob, with CORS

    @unit
    Scenario: Outboundsim refuses the wrong Azure account and an expired token
      When a call is signed with another account's key, or names an account outboundsim does not hold
      Then it is refused 403 AuthenticationFailed
      And a managed-identity token from /azure-msi/token lives six minutes, after which a blob call is refused 401

    @unit
    Scenario: Outboundsim is a push service that records each send per device
      When the product sends a VAPID-signed aes128gcm message to /push/<device>
      Then outboundsim answers 201 and /_sim/api/push counts the send against that device
      And a bad signature or another aud is refused 403, a missing TTL 400
      And a device named gone, or told to by PUT /_sim/api/push/<device>, answers 410 (or 404, 429)

    @unit
    Scenario: haven gives outboundsim an https listener on 127.0.0.1 for the push stand-in
      Given the portless Local CA exists and the stack selects outbound
      When haven plans the stack
      Then it issues a 127.0.0.1 certificate from that CA and outboundsim serves its routes over https on a second port
      And the overlay sets WEB_PUSH_SERVICE_BASE to https://127.0.0.1:<that port>/push unless .env names one
      And without the CA there is no https listener and no push base
