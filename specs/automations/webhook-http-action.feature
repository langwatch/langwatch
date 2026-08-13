Feature: Webhook (generic HTTP) automation action
  Automations can deliver to a customer-supplied HTTP endpoint (ADR-040):
  on a trace match or a graph alert, LangWatch renders a Liquid body — JSON
  by default, any media type via the Content-Type header — and sends it to
  the configured URL over an SSRF-fenced HTTP client. Every project has the
  channel.

  Rule: Authoring a webhook automation

    @integration
    Scenario: The webhook card appears among the notify channels
      Given a user opens the delivery picker in the automation drawer
      Then a "Webhook" card is offered alongside Email and Slack
      And picking it opens the webhook setup

    @integration
    Scenario: A webhook automation configures a URL, method, headers, and a body
      Given a user picks the Webhook delivery
      Then the user sets the destination URL and HTTP method
      And can add static request headers
      And can author the body as a Liquid template
      And leaving a JSON body empty sends the framework default payload

    @integration
    Scenario: Only https URLs are accepted
      Given a user enters an http:// destination URL
      Then the authoring form rejects it, explaining the URL must be https

    @integration
    Scenario: Non-standard ports are rejected
      Given a user enters an https URL with port 8443
      Then the authoring form rejects it, explaining only the default https port is allowed

  Rule: The Content-Type header decides how the body is treated

    The declared Content-Type is one decision doing all the work: it is the
    header the delivery announces, it decides whether the body is checked as
    JSON or sent verbatim, and the authoring surface adapts its editor and
    preview to it. Nothing is forced — an endpoint that wants XML gets XML,
    announced as XML.

    @unit
    Scenario: A JSON body is checked and sent as JSON
      Given a webhook automation with the default Content-Type of application/json
      When the automation fires
      Then the endpoint receives valid JSON at the configured URL
      And the request is announced as application/json

    @unit
    Scenario: A JSON body that does not parse falls back to the framework default
      Given a JSON body whose template renders something that is not JSON
      When the automation fires
      Then the framework default payload is sent instead
      And the author is shown what broke

    @unit
    Scenario: A plain-text body is sent exactly as it renders
      Given a webhook automation whose Content-Type is set to text/plain
      When the automation fires
      Then the endpoint receives the rendered template byte for byte
      And the request is announced with the Content-Type the author declared

    @unit
    Scenario: A plain-text body that fails to render sends nothing
      Given a non-JSON body whose template cannot render
      When the automation fires
      Then the endpoint receives an empty body, not a JSON envelope it cannot read
      And the author is shown what broke, as they are for a JSON body

    @unit
    Scenario: An automation saved before content types existed still sends JSON
      Given a webhook automation saved without stating a Content-Type
      When it is fired
      Then it renders the JSON envelope and announces it as application/json,
        exactly as it did before the field existed

    @integration
    Scenario: Content-Type is a fixed header row that defaults to JSON
      Given a user picks the Webhook delivery
      Then the headers editor leads with a Content-Type row already set to application/json
      And the row cannot be removed, only edited
      And a value that is not a media type is rejected where it is typed

    @integration
    Scenario: The editor and preview follow the declared Content-Type
      Given a webhook automation on the default JSON content type
      Then the body editor speaks JSON and the preview is highlighted as JSON
      When the author changes the Content-Type to text/plain
      Then the body editor and preview stop treating the body as JSON

  Rule: Header values are secrets

    @unit
    Scenario: Header values are stored encrypted at rest
      When a webhook automation is saved with an Authorization header
      Then the stored automation holds only ciphertext, never the plaintext value

    @integration
    Scenario: Saved header values never return to the browser
      Given a webhook automation saved with an Authorization header
      When the automation is opened for editing
      Then the header name is shown but its saved value is not
      And saving with the value left untouched keeps the saved secret

    @unit
    Scenario: Renaming a saved header requires re-entering its value
      Given a webhook automation saved with an Authorization header
      When the user renames that header while editing
      Then the saved value is not carried over to the new name

  Rule: Testing a webhook from the drawer

    @unit
    Scenario: A test fire sends the rendered request to the configured endpoint
      Given a webhook automation draft with a URL set
      When the user presses "Send a test"
      Then the rendered body is sent to that URL through the SSRF-fenced sender
      And the request carries a non-suppressible X-LangWatch-Test-Fire header

    @integration
    Scenario: A successful test shows the real status code inline
      Given the endpoint answers 200
      When the test fire completes
      Then a confirmation with the HTTP status appears next to the test button

    @integration
    Scenario: A failing test shows the error inline next to the test button
      Given the endpoint answers 500 or is unreachable
      When the test fire completes
      Then an inline error appears next to the test button naming what went wrong
      And the error includes the HTTP status or transport failure

    @integration
    Scenario: Test fires are rate limited
      Given a user has spent the test-fire allowance for the last minute
      When they press "Send a test" again
      Then the test fire is rejected asking them to retry later

  Rule: Delivery is SSRF-fenced

    @unit
    Scenario: Requests to private or internal addresses are blocked
      Given a webhook automation whose URL resolves to a private, loopback,
        link-local, or cloud-metadata address
      When the automation fires or is test-fired
      Then the request fails terminally, and is not retried

    @unit
    Scenario: Redirects are not followed
      Given the endpoint answers with a 3xx redirect
      When the automation fires
      Then the redirect is not followed and the delivery fails terminally

  Rule: Dispatch classification

    @unit
    Scenario: Server errors are retried
      When the endpoint answers 500, 502, 503, 429, or 408
      Then the dispatch is classified retryable, so the process manager attempts it again

    @unit
    Scenario: Client errors fail terminally without retry
      When the endpoint answers 3xx or any other 4xx
      Then the dispatch is classified terminal, because retrying a misconfigured
        endpoint only spams it

    @unit
    Scenario: An endpoint that never answers is retried, not waited on
      Given the endpoint accepts the connection and then never responds
      When the automation fires
      Then the attempt gives up on our own timeout and is classified retryable

    @unit
    Scenario: A receiver's Retry-After is carried onto the failure
      Given the endpoint answers 429 with a Retry-After header
      When the dispatch fails
      Then the receiver's delay rides on the failure, so the queue's backoff
        cannot be shorter than the receiver asked for

    @unit
    Scenario: Every attempt of one fire carries the same event id
      Given a dispatch is retried after only part of its candidate batch was claimed
      Then each attempt sends the same X-LangWatch-Event-Id
      So a receiver can dedupe replays of the same fire

    @unit
    Scenario: A project cannot flood an endpoint
      Given a project has reached its hourly webhook dispatch cap
      When another webhook fires
      Then that dispatch backs off without contacting the endpoint at all

  Rule: Delivery log

    @unit
    Scenario: Each attempt is recorded with its outcome
      Given a webhook automation that fires
      When the attempt completes
      Then one row is recorded, carrying the dispatch id, the HTTP status,
        the latency, and the outcome

    @unit
    Scenario: An attempt that never reached the endpoint is recorded too
      Given a webhook automation whose request is blocked before it is sent
      Then a row is still recorded, with the error and the latency but no status

    @unit
    Scenario: The delivery log never stores request content
      Given a webhook automation with custom headers that fires
      Then the delivery row stores the outcome, status, latency, and a capped error summary
      And the request URL, headers, and body are never stored

    @unit
    Scenario: A failed attempt keeps the receiver's response for debugging
      Given a webhook automation whose endpoint answers an error
      When the attempt fails
      Then the truncated response body and headers are stored exactly as the endpoint sent them

    @integration
    Scenario: The recent deliveries list shows what the endpoint answered
      Given a webhook automation with a failed delivery attempt
      When the user expands that attempt in the drawer
      Then the receiver's response body and headers are shown as literal text,
        never rendered as markup

    @integration
    Scenario: The delivery log is pruned after 30 days
      Given delivery rows older than 30 days exist
      When the delivery-log prune runs
      Then those rows are deleted and newer rows are kept

    # Unimplemented: no test populates a stored `response` before the retention
    # sweep, so nothing proves the receiver's body and headers go with the row.
    @integration @unimplemented
    Scenario: The prune deletes the stored response with its row
      Given a pruned delivery row that had kept the receiver's response
      Then that response body and headers are gone with it

    @unit
    Scenario: A terminally failing endpoint is not re-posted every evaluation
      Given a graph alert webhook whose endpoint answers a terminal error
      When the alert fires and delivery fails terminally
      Then the fire stays consumed, so the next evaluation does not post again

    @unit
    Scenario: A retry of a graph alert does not re-send to an endpoint already reached
      Given a graph alert webhook that has already delivered for this fire
      When the same fire is retried
      Then the endpoint is not contacted a second time
