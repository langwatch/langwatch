Feature: Automations over the public API
  The `/api/triggers` REST surface lets an integrator, the LangWatch CLI, an
  MCP client and any agent read and write automations with a project API key.
  Its responses are machine output: they are logged, piped into files and
  pasted into agent transcripts, so what leaves this boundary is held to the
  machine-surface rule rather than the dashboard's.

  Delivery credentials are redacted at the REST boundary. An automation's
  delivery configuration is returned with its shape intact — which channel,
  which destination is set, which header names are configured — and every
  credential value replaced by a stable placeholder. The redaction is
  structured: it names the fields that hold credentials per delivery channel
  and substitutes the placeholder there. It never scans prose for something
  that looks like a secret.

  Related: #6716, dev/docs/adr/040-webhook-automation-action.md (header values
  and signing secrets are secrets), dev/docs/adr/041-slack-bot-delivery.md.

  Background:
    Given a project with an API key

  Rule: Delivery credentials are redacted at the REST boundary

    @integration
    Scenario: A listed trigger never contains a secret
      Given an automation that delivers to a Slack incoming webhook
      And an automation that delivers to a customer endpoint with an authorization header
      When the automations are listed over the API
      Then the response carries the placeholder in place of each credential value
      And no credential value appears anywhere in the response

    @integration
    Scenario: Reading one trigger redacts it the same way
      Given an automation that delivers to a Slack incoming webhook
      When that automation is read by its id over the API
      Then no credential value appears anywhere in the response

    @integration
    Scenario: Creating a trigger echoes it back redacted
      When an automation is created over the API with a Slack incoming webhook
      Then the created automation is returned with the placeholder in place of the webhook URL
      And the automation still delivers to the configured webhook

    @integration
    Scenario: Updating a trigger echoes it back redacted
      Given an automation that delivers to a Slack incoming webhook
      When the automation is renamed over the API
      Then no credential value appears anywhere in the response

    @unit
    Scenario: The delivery shape survives redaction
      Given an automation that delivers to a customer endpoint with an authorization header
      When the automation is redacted for the public API
      Then the destination and the header name are still readable
      And the header value is the placeholder

    @unit
    Scenario: A delivery channel the server no longer offers returns nothing
      Given a stored automation whose delivery channel is not one this server offers
      When the automation is redacted for the public API
      Then its delivery configuration is returned empty

  Rule: Clients read the redacted response as it arrives

    @unit
    Scenario: The command line prints what the API returned
      Given the API returns an automation with redacted delivery credentials
      When a user runs the trigger read command
      Then the machine output carries exactly the fields the API returned
