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

    @integration
    Scenario: Deleting a trigger reports the deletion
      Given an automation that delivers to a Slack incoming webhook
      When the automation is deleted over the API
      Then the response names the deleted automation and says it is deleted

    @unit
    Scenario: A delivery configuration that cannot be read comes back empty
      Given a stored automation whose saved credentials cannot be read back
      When the automation is redacted for the public API
      Then its delivery configuration is returned empty
      And the rest of the automation is still readable

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

    @unit
    Scenario: A delivery channel the server no longer offers is written as it was sent
      Given a stored automation whose delivery channel is not one this server offers
      When a delivery configuration is saved for it over the API
      Then it is stored as the caller sent it

  Rule: Writing the read response back keeps the stored credential

    An integrator reads an automation, changes one thing and writes the whole
    object back. Every credential in that payload is the placeholder, or — for
    a stored Slack bot token — the flag saying one is set. Each of them means
    "keep what is stored", whichever channel it belongs to and whether the
    value is held as it was given or encrypted at rest.

    @integration
    Scenario: An integrator writes the read response back and the stored credential survives
      Given an automation that delivers to a customer endpoint with an authorization header and a signing secret
      When the integrator reads it over the API and writes the response back unchanged
      Then the automation still delivers with the same header value
      And it still signs its deliveries with the same secret

    @integration
    Scenario: Writing back a Slack bot connection keeps its saved token
      Given an automation that delivers through a Slack bot connection
      When the integrator reads it over the API and writes the response back unchanged
      Then the automation still delivers with the saved bot token

    @integration
    Scenario: A destination the caller did type is the one that is saved
      Given an automation that delivers to a Slack incoming webhook
      When the integrator writes back a different webhook URL
      Then the automation delivers to the URL the integrator typed

    @integration
    Scenario: Writing back a graph alert keeps the rule it fires by
      Given a graph alert that notifies Slack when a series crosses a threshold
      When the integrator reads it over the API and writes the response back unchanged
      Then the alert still fires on the same series, threshold and time window

    @integration
    Scenario: Writing back a scheduled report keeps its schedule
      Given a report that sends to Slack on a schedule
      When the integrator reads it over the API and writes the response back unchanged
      Then the report still sends the same content on the same schedule

  Rule: An update states the delivery configuration in full

    An update replaces the delivery configuration rather than merging into it,
    so an integrator sends the fields the automation should have from now on.
    A credential the read hid is the exception: sent back as the placeholder,
    it means the one already stored.

    @integration
    Scenario: Leaving a header out of an update removes it
      Given an automation that delivers to a customer endpoint with an authorization header
      When the integrator updates it and states no headers at all
      Then the automation delivers without any header

  Rule: The API saves what the dashboard would accept

    An automation written over the API is the same kind of row the dashboard
    writes, so it is held to the same rules: a delivery configuration its
    channel recognises, a destination that is safe to send to, a channel the
    project actually has, and the cadence a new notification starts on.

    @integration
    Scenario: A delivery configuration its channel does not recognise is refused
      When an automation is created over the API with a Slack delivery that names no destination
      Then the save is refused as an unusable delivery configuration
      And no automation is created

    @integration
    Scenario: A destination that is not https is refused
      Given the project has the webhook channel
      When an automation is created over the API delivering to an http destination
      Then the save is refused as an unusable delivery configuration
      And no automation is created

    @integration
    Scenario: The webhook channel stays closed until the project has it
      Given the project does not have the webhook channel
      When an automation is created over the API delivering to a customer endpoint
      Then the save is refused as a channel this project does not have
      And no automation is created

    @integration
    Scenario: A new notification automation starts on the cadence that protects against storms
      When an automation that emails on matching traces is created over the API
      Then it starts on the same digest cadence a dashboard-authored one does

    @integration
    Scenario: An automation whose only conditions are unsupported is refused
      When an automation is created over the API with only conditions this platform no longer supports
      Then the save is refused as a condition it cannot act on
      And no automation is created

    @integration
    Scenario: The listing includes paused automations
      Given an automation that has been paused
      When the automations are listed over the API
      Then the paused automation is in the listing

  Rule: The API expresses the automations the dashboard expresses

    An integrator can write, over the API, every kind of automation the
    composer writes: one about matching traces, one about a metric crossing a
    threshold, one that sends on a schedule. The row it writes is the row the
    dashboard reads back, so an automation authored either way looks the same
    from the other side.

    @integration
    Scenario: A graph alert created via the API renders in the UI
      Given a graph in the project
      When an alert on that graph is created over the API
      Then the dashboard reads back the same series, threshold and time window
      And it reads back as an alert rather than as a trace automation

    @integration
    Scenario: An alert on a graph from another project is refused
      Given a graph in another project
      When an alert on that graph is created over the API
      Then the save is refused as a graph this project does not have

    @integration
    Scenario: The upsert shape is expressible over the API
      When an automation is created over the API with templates, a cadence, a
      settle time and a trace query
      Then each of them is saved on the automation

    @integration
    Scenario: A trace query the platform cannot read is refused
      When an automation is created over the API with a trace query that
      cannot be read
      Then the save is refused as a query it cannot read

    @unit
    Scenario: Each channel's delivery configuration is published by name
      When the API's delivery schemas are read
      Then each one names the fields its channel actually reads

  Rule: What an automation delivers on, and what it is about, are fixed

    The channel is fixed because the credential rules depend on it: keeping a
    stored secret across a save is only sound while the incoming and the stored
    delivery configuration belong to the same channel. The kind is fixed
    because an alert owns its graph's alert slot and a report owns a calendar
    entry. Both are refused rather than ignored, so an integrator writing the
    whole read response back is told what happened.

    @integration
    Scenario: The delivery channel cannot be changed over the API
      Given an automation that emails on matching traces
      When the integrator writes it back naming a different channel
      Then the save is refused as a channel that cannot be changed
      And the automation still delivers on the channel it was created with

    @integration
    Scenario: An automation cannot become an alert over the API
      Given an automation that emails on matching traces
      When the integrator writes it back with a threshold rule
      Then the save is refused as a kind that cannot be changed

  Rule: A delivery configuration is read against the channel it belongs to

    Which channel an automation delivers on is known before its configuration
    is read — named on a create, taken from the stored row on an update — so
    the shape is never inferred from what the payload resembles. A field that
    channel does not have is refused rather than dropped: dropped, it saves an
    automation that delivers nowhere, and on an update, where the payload
    replaces the stored configuration whole, it saves one that stops
    delivering at all.

    @integration
    Scenario: A field the channel does not have is refused, not dropped
      When an automation is created over the API with a misspelt destination field
      Then the save is refused, naming the field it sent and the fields the channel reads
      And no automation is created

    @integration
    Scenario: Another channel's field cannot be parked on this one
      Given an automation that emails on matching traces
      When the integrator updates it with a field belonging to another channel
      Then the save is refused as a field this channel does not have
      And the automation still delivers to the recipients it had

    @unit
    Scenario: Another channel's field never survives as part of the rule
      When a delivery configuration carrying another channel's field is saved
      Then that field is not stored as part of the rule the automation fires by

    @unit
    Scenario: The rule an automation fires by still survives a save
      When a delivery configuration carrying a threshold rule is saved
      Then the rule is stored alongside the delivery configuration

  Rule: The rule an automation fires by is stated in its own field

    At rest the rule and the delivery configuration share one column; on the
    wire they are separate fields. A rule sent inside the delivery
    configuration used to be overwritten by the stored one on the way to
    storage, so the save answered success and changed nothing.

    @integration
    Scenario: A rule sent in the delivery configuration is refused
      Given a graph alert that notifies when a series crosses a threshold
      When the integrator sends a new threshold inside the delivery configuration
      Then the save is refused, saying where the rule belongs
      And the alert still fires on the threshold it had

    @integration
    Scenario: The read states the rule where a write states it
      Given a graph alert that notifies when a series crosses a threshold
      When it is read over the API
      Then the rule comes back in its own field
      And the delivery configuration carries only where the message goes

  Rule: A refusal says what to do about the thing that is wrong

    @integration
    Scenario: A report with nothing readable to send says what to state
      Given a report whose stored configuration can no longer be read
      When the integrator saves a change to it
      Then the save is refused, asking for what it sends and when
      And it does not ask for a different channel

  Rule: A project can only make LangWatch send so often

    A test fire is the one verb here that sends on the caller's say-so, to an
    address the same caller chose — an email through the shared provider, or a
    request from our workers at an arbitrary destination. Uncapped, either is a
    flood primitive driven from an API key, so both are capped per project, the
    same window the dashboard uses. Slack is exempt: its destination is pinned
    to Slack's own hosts.

    @integration
    Scenario: Test fires are capped per project
      Given an automation that emails on matching traces
      When the project test-fires more often than a minute allows
      Then the next test fire is declined as too many
      And nothing further is sent

    @integration
    Scenario: A Slack test fire is not capped
      Given an automation that delivers to a Slack incoming webhook
      When the project test-fires it many times in a minute
      Then every one of them is sent

  Rule: Header values travel with the destination they authenticate against

    A header value is issued for one endpoint, so it does not follow that
    endpoint's replacement. The dashboard tells an author to re-enter the
    values; an API caller never held them, so it is told to send them — one
    call carrying the new destination and each header's value saves both.

    @integration
    Scenario: Retargeting and re-stating the header values succeeds in one call
      Given an automation that delivers to a customer endpoint with an authorization header
      When the integrator sends a new destination and the header value together
      Then the automation delivers to the new destination with the value it sent

    @integration
    Scenario: Retargeting while keeping the stored header values is refused
      Given an automation that delivers to a customer endpoint with an authorization header
      When the integrator sends a new destination and asks to keep the stored header value
      Then the save is refused, saying the values have to travel with the destination
      And the automation still delivers to the destination it had

  Rule: An automation can be exercised and inspected over the API

    @integration
    Scenario: API test-fire delivers to the automation's own destination
      Given an automation that emails on matching traces
      When it is test-fired over the API
      Then the message goes to the recipients the automation is saved with

    @integration
    Scenario: A test fire with nothing to deliver to says so
      Given an automation that appends matched traces to a dataset
      When it is test-fired over the API
      Then the API says there is nothing to test-fire
      And nothing is delivered

    @integration
    Scenario: Fire history is readable over the API
      Given an automation that has fired more than once
      When its fires are read over the API
      Then they come back newest first

    @integration
    Scenario: Pausing and resuming round-trips over the API
      Given an automation that emails on matching traces
      When it is paused and then resumed over the API
      Then each call answers with the state it is now in
      And the automation no longer claims it was paused

  Rule: A channel a project no longer has stays readable

    Turning a delivery channel off for a project stops new configuration on it.
    The automations already saved on that channel stay listed, readable and
    manageable, because taking them away would leave an operator unable to
    pause or delete something that is still delivering.

    @integration
    Scenario: An existing webhook automation stays readable and manageable
      Given an automation that delivers to a customer endpoint
      And the project no longer has the webhook channel
      Then it is still listed, readable, renameable, pausable and deletable

    @integration
    Scenario: Changing an existing webhook automation's delivery is refused
      Given an automation that delivers to a customer endpoint
      And the project no longer has the webhook channel
      When the integrator states a new delivery configuration for it
      Then the save is refused as a channel this project does not have

  Rule: The automation an id names is the caller's own

    @integration
    Scenario: An automation in another project reads as one that does not exist
      Given an automation in another project
      When it is read by its id over the API
      Then the API answers that no such automation exists

  Rule: Clients read the redacted response as it arrives

    @unit
    Scenario: The command line prints what the API returned
      Given the API returns an automation with redacted delivery credentials
      When a user runs the trigger read command
      Then the machine output carries exactly the fields the API returned
