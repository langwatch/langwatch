Feature: Webhook (generic HTTP) automation action
  Automations can deliver to a customer-supplied HTTP endpoint (ADR-040):
  on a trace match or a graph alert, LangWatch renders a Liquid JSON body
  and sends it to the configured URL over an SSRF-fenced HTTP client.
  The channel ships dark behind the release_webhook_automations flag.

  Background:
    Given the release_webhook_automations flag is on for the project

  Rule: Authoring a webhook automation

    Scenario: The webhook card appears among the notify channels
      Given a user opens the delivery picker in the automation drawer
      Then a "Webhook" card is offered alongside Email and Slack
      And picking it opens the webhook setup

    Scenario: A webhook automation configures a URL, method, headers, and a JSON body
      Given a user picks the Webhook delivery
      Then the user sets the destination URL and HTTP method
      And can add static request headers
      And can author the JSON body as a Liquid template
      And leaving the body empty sends the framework default payload

    Scenario: Only https URLs are accepted
      Given a user enters an http:// destination URL
      When they save the automation
      Then the save is rejected explaining the URL must be https

    Scenario: Non-standard ports are rejected
      Given a user enters an https URL with port 8443
      When they save the automation
      Then the save is rejected explaining only the default https port is allowed

    Scenario: The flag hides the channel end to end
      Given the release_webhook_automations flag is off for the project
      Then the delivery picker does not offer the Webhook card
      And saving a webhook automation through the API is rejected

  Rule: Header values are secrets

    Scenario: Header values are stored encrypted at rest
      When a webhook automation is saved with an Authorization header
      Then the stored automation does not contain the header value in plaintext

    Scenario: Saved header values never return to the browser
      Given a webhook automation saved with an Authorization header
      When the automation is opened for editing
      Then the header name is shown but its saved value is not
      And saving with the value left untouched keeps the saved secret

    Scenario: Renaming a saved header requires re-entering its value
      Given a webhook automation saved with an Authorization header
      When the user renames that header while editing
      Then the header's value must be typed again before it is sent

  Rule: Testing a webhook from the drawer

    Scenario: A test fire sends the rendered request to the configured endpoint
      Given a webhook automation draft with a URL set
      When the user presses "Send a test"
      Then the rendered JSON body is sent to that URL through the SSRF-fenced sender
      And the request carries a non-suppressible X-LangWatch-Test-Fire header

    Scenario: A successful test shows the real status code inline
      Given the endpoint answers 200
      When the test fire completes
      Then a confirmation with the HTTP status appears next to the test button

    Scenario: A failing test shows the error inline next to the test button
      Given the endpoint answers 500 or is unreachable
      When the test fire completes
      Then an inline error appears next to the test button naming what went wrong
      And the error includes the HTTP status or transport failure

    Scenario: Test fires are rate limited
      Given a user has sent many webhook test fires within the last minute
      When they press "Send a test" again
      Then the test fire is rejected asking them to retry later

  Rule: Delivery is SSRF-fenced

    Scenario: Requests to private or internal addresses are blocked
      Given a webhook automation whose URL resolves to a private, loopback,
        link-local, or cloud-metadata address
      When the automation fires or is test-fired
      Then the request is blocked before any connection is made
      And the failure is terminal, not retried

    Scenario: Redirects are not followed
      Given the endpoint answers with a 3xx redirect
      When the automation fires
      Then the redirect is not followed and the delivery fails terminally

  Rule: Dispatch classification

    Scenario: Server errors retry, client errors do not
      When the endpoint answers 500, 429, or 408, or times out
      Then the dispatch is retried by the outbox
      When the endpoint answers any other 4xx
      Then the dispatch fails terminally without retry

    Scenario: A terminally failing endpoint is not re-posted every evaluation
      Given a graph alert webhook whose endpoint answers a terminal error
      When the alert fires and delivery fails terminally
      Then the fire is consumed and the endpoint is not contacted again for it

    Scenario: A graph alert can deliver to a webhook
      Given a graph alert automation with the Webhook delivery
      When the alert fires
      Then the alert-shaped JSON body is sent to the configured URL
      And a retry of the same fire does not re-send to an endpoint already reached
