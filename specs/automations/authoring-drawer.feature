Feature: Staged automation authoring drawer

  A user creates and edits an automation through a single drawer of section
  rows that open into secondary drawers. The drawer reveals each section as
  the previous one is completed, so the surface stays small whether the
  automation is a notification (Slack, email) or an action (add to dataset,
  add to annotation queue). The same drawer edits an existing automation,
  with every section pre-filled.

  This replaces the previously separate create drawer, "customize message"
  form, and template editor. The template-authoring sub-flow (live preview,
  test fire) is reachable inside the Configuration secondary drawer for
  notification types.

  See dev/docs/adr/037-automation-operator-surfaces.md.

  Background:
    Given a user authoring an automation in a project

  Rule: The drawer reveals sections progressively

    Scenario: A new automation starts at identity, then picks a type
      When the user opens the automation drawer
      Then the identity row (name + alert type) is visible at the top
      And the When section is visible
      And the type picker is visible
      And Setup, Cadence, and Test sections are not yet available

    Scenario: Choosing a category offers the matching types
      Given the user is creating an automation
      When the user opens the type picker
      Then the picker offers Slack and email under Notification
      And the picker offers add-to-dataset and add-to-annotation-queue under Action

    Scenario: A completed section collapses to a one-line summary
      Given the user has chosen a type and configured a destination
      When the user returns to the main drawer pane
      Then earlier sections show a one-line summary of their state
      And the user can reopen any section to change it

    Scenario: Changing the type clears configuration that no longer applies
      Given the user has configured an email notification
      When the user changes the type to Slack
      Then the email-specific configuration is cleared
      And the Slack configuration secondary opens empty

  Rule: Conditions decide when the automation fires

    Scenario: An automation created from settings requires a condition
      Given the user opened the drawer from automation settings
      When the user tries to save without any condition
      Then saving is blocked until at least one condition is set

    Scenario: An automation created from the traces view pre-fills the conditions
      Given the user opened the drawer from a filtered traces view
      When the When section is shown
      Then it is pre-filled with the active trace filters

  Rule: No API can create an automation that fires on every trace

    The drawer has always blocked a condition-less automation, but only in the
    browser. Every server write path accepted one, and the REST API went
    further and DEFAULTED the condition to empty when the caller omitted it, so
    the easiest possible create call produced an automation that matches every
    trace forever. That is the one genuinely customer-facing hole behind the
    volume incident, and it is closed on the server where the drawer's rule
    always belonged.

    A condition is satisfied either way an automation can express one: a
    non-empty structured filter set, or a query string. Alerts and reports are
    exempt, because a graph-threshold alert's condition is the threshold and it
    has no trace filter to require.

    @integration
    Scenario: Creating an automation with no condition is refused
      Given a create request for an automation with no condition
      When the server handles it
      Then the request is refused with a condition-required error

    @integration
    Scenario: Editing an automation down to no condition is refused
      Given an existing automation with a condition
      When a request replaces its condition with an empty one
      Then the request is refused with a condition-required error
      And the stored condition is unchanged

    @integration
    Scenario: A query is a condition on its own
      Given a create request whose only condition is a query string
      When the server handles it
      Then the automation is created

    @integration
    Scenario: Alerts and reports do not need a trace condition
      Given a create request for a graph alert with no trace condition
      When the server handles it
      Then the alert is created

    @integration
    Scenario: The REST API no longer invents an empty condition
      Given a REST create request that omits the condition entirely
      When the server handles it
      Then the request is refused with a condition-required error
      And the response carries the machine-readable condition-required code

    # The edit rule above is stated once for every write path, but the REST edit
    # is the one that can leave a half-applied automation behind, so it names
    # its own contract: the machine-readable code the caller matches on, and the
    # stored condition surviving the refusal untouched.
    @integration
    Scenario: A REST edit that empties the condition changes nothing
      Given a stored automation whose condition is a filter set
      When a REST patch replaces that condition with an empty one
      Then the request is refused with the machine-readable condition-required code
      And the stored condition is unchanged

    @integration
    Scenario: Automations that predate the rule keep firing
      Given a stored automation with no condition at all
      When one of its matches dispatches
      Then the dispatch behaves exactly as before

    # The save-time validation counts any non-empty nested value as a
    # condition, but the dispatch-time matcher only resolves two levels of
    # nesting. A shape it cannot evaluate has to fail closed: an automation
    # whose condition the matcher cannot read must fire on nothing, because
    # firing on everything is the exact hole this rule closes.
    @unit
    Scenario: A condition the matcher cannot evaluate fails closed
      Given a stored automation whose condition nests deeper than the matcher resolves
      When a trace is evaluated against it
      Then the automation does not match

  Rule: Links to an automation survive a change of drawer

    The REST `platformUrl` field and the automation emails name a drawer inside
    the URL they hand out, and those URLs outlive the drawer they were written
    for: they sit in inboxes and in whatever a caller stored from an API
    response. A name that stops resolving turns every one of them into a dead
    link. A name that resolves to the filter-only drawer is worse than dead in
    the case that matters, because a limit email asks the customer to narrow a
    condition and that drawer cannot edit a query at all.

    @integration
    Scenario: A link issued before the drawer changed still opens the automation
      Given a link that names the drawer the API used to hand out
      When the app resolves that URL
      Then it opens the automation authoring drawer

    # The link is minted into a message that has already left the product, so a
    # name that does not resolve cannot be corrected afterwards: every alert we
    # have ever sent lands on the automations list with nothing open, and the
    # reader is given no error to report. The receiving side is where this is
    # fixed — the application registers the name the email already writes.
    @integration
    Scenario: An alert email's Edit automation link opens the automation it names
      Given an alert email whose Edit automation link carries the automation's id
      When the recipient follows that link into the application
      Then the automation authoring drawer opens on that automation
      And the drawer is told the reader arrived from an email

  Rule: The list opens the same editor the links do

    An automation is opened from a row on the automations page, from the "Edit
    automation" link in an alert email, from the REST API's `platformUrl`, from
    the trace explorer's Automate button and from the command bar. The page used
    to open its own two overlays at addresses only that page understood, so a
    reader who copied the URL out of the address bar and sent it to a colleague
    sent a link that opened the list with nothing on it. Every way in writes the
    same address now.

    @integration
    Scenario: The automations list opens its viewer at the registered address
      Given the project has an automation
      When the user clicks its row
      Then the automation viewer opens on that automation
      And the list does not draw a second copy of it

    @integration
    Scenario: The automations list opens its editor at the registered address
      Given the project has an automation
      When the user picks Edit from that row's actions
      Then the automation editor opens on that automation

    @integration
    Scenario: Creating an automation opens the editor with no automation named
      When the user starts a new automation
      Then the automation editor opens naming no automation to load

    @integration
    Scenario: The automation viewer hands over to the editor at its registered address
      Given the automation viewer is open on an automation
      Then it is given a way to open the editor on the same automation

  Rule: Notifications configure templates; actions configure destinations

    Scenario: An email notification configures recipients and templates
      Given the user is configuring an email notification
      Then the user sets the recipients, the subject template, and the body template

    Scenario: Email recipients outside the team are allowed but marked
      Given the user is configuring an email notification
      When the user adds "alerts@partner.com" as a recipient
      Then the recipient is accepted
      And it is shown with an "External" warning badge

    Scenario: A Slack notification configures a destination and a message template
      Given the user is configuring a Slack notification
      Then the user sets the channel and the message template

    Scenario: A dataset action configures the destination only
      Given the user is configuring an add-to-dataset action
      Then the user selects the target dataset
      And no template section is shown

    # A project with no dataset has nothing to select, so the create
    # affordance is the only way out of the section. Creation is the dataset
    # drawer's job, so the section hands over to it and comes back.
    @integration
    Scenario: Creating a dataset from the automation is offered and works
      Given the user is configuring an add-to-dataset action
      And the project has no dataset yet
      When the user chooses to create a dataset
      Then the dataset drawer opens
      And the created dataset becomes the automation's target
      And the automation drawer is back with its draft intact

    # The picker clears its selection when it hands over, so an ending
    # without a created dataset has to put the earlier target back: without
    # it the author opens the dataset drawer, changes their mind, and
    # silently loses the dataset the automation already pointed at.
    @integration
    Scenario: Leaving the dataset drawer without creating keeps the dataset already chosen
      Given the user is configuring an add-to-dataset action
      And the user has chosen a dataset
      When the user chooses to create a dataset
      And the user closes the dataset drawer without creating one
      Then the dataset chosen before is still the automation's target
      And the automation drawer is back

    # The draft is kept across the hand-over, so something has to discard it
    # when the user never comes back. Otherwise the next new automation opens
    # holding the abandoned one.
    @unit
    Scenario: An abandoned sub-flow does not seed the next automation
      Given the user is configuring an add-to-dataset action
      When the user chooses to create a dataset
      And the user goes to another page instead of returning
      And the user starts a new automation later
      Then the new automation starts empty

  Rule: The Slack channel list never claims to be complete when it isn't

    The picker is populated from what the bot token can see, and there are
    several ways that view comes back partial: a scope the app was never
    granted, and a workspace with more channels than the picker can list. A
    partial list that looks complete is worse than no list — the author scrolls
    past the channel they wanted, concludes the integration is broken, and has
    nothing to act on. Whenever the list is short of the workspace, the author
    is told so and given the way through.

    Scenario: The workspace has more channels than the picker can list
      Given the user is configuring a Slack notification
      And the workspace has more channels than the picker can list
      Then the channels that were retrieved are offered
      And the author is told the list is incomplete
      And the author is told they can enter the channel directly instead

    Scenario: The app cannot see private channels
      Given the user is configuring a Slack notification
      And the Slack app cannot see the workspace's private channels
      Then the public channels are still offered
      And the author is told private channels are missing and which permission adds them

    Scenario: The whole workspace fits in the list
      Given the user is configuring a Slack notification
      And the workspace has few enough channels for the picker to list them all
      Then every channel is offered
      And no incompleteness notice is shown

    Scenario: A channel the list never returned can still be used
      Given the user is configuring a Slack notification
      And the channel they want is absent from the list
      When the author enters the channel themselves
      Then it is accepted as the destination

  Rule: Cadence and debounce apply per trigger

    Scenario: The cadence section is hidden for action triggers
      Given the user is authoring an add-to-dataset action
      Then no cadence section is shown
      And the trace-settle wait setting is still available inside the cadence-equivalent surface

    Scenario: The cadence section is shown for notification triggers
      Given the user is authoring an email notification
      Then the cadence section is available
      And it exposes the delivery-cadence dropdown
      And it exposes the trace-settle wait setting

    Scenario: Cadence defaults to a 5-minute digest for new notifications
      Given the user is creating a new email automation
      When the cadence section opens
      Then the cadence is "Every 5 minutes" by default

    Scenario: A new notification cannot be saved until the cadence is reviewed
      Given the user is creating a new notification automation
      And the trigger and setup sections are complete
      Then the cadence section is not marked complete
      And saving is blocked with a prompt to review the cadence
      When the user opens the cadence section and confirms it
      Then the cadence section is marked complete
      And the automation can be saved

    Scenario: Editing an existing notification does not re-demand a cadence review
      Given the user opens an existing notification automation for editing
      Then the cadence section is already marked complete

  Rule: The author can preview templates and test fire before saving

    Scenario: Opening the template editor for a trigger with no custom templates
      Given the user is configuring a notification with no custom templates
      Then the email subject, email body, and Slack fields show the framework defaults
      And a list of the variables a template can reference is shown

    Scenario: Editing the email body updates the live preview
      Given the user is editing the email body template
      When the user changes the template text
      Then the preview shows the body rendered to HTML against sample data

    Scenario: A template referencing a missing variable previews with a warning
      Given the user writes a template referencing a variable the context does not provide
      When the preview renders
      Then the missing variable renders as empty in the preview
      And the operator is warned which variable names were missing

    Scenario: A Block Kit template previews as rendered blocks and opens in the Builder
      Given the user selects the Block Kit Slack template type
      And writes a template that renders valid Block Kit JSON
      When the preview renders
      Then the allowed blocks are shown rendered in-app
      And the operator can open the same blocks in the Slack Block Kit Builder

    Scenario: Interactive blocks are dropped from the Block Kit preview
      Given the user writes a Block Kit template containing an interactive actions block
      When the preview renders
      Then the interactive block is not shown in the preview

    Scenario: Invalid Block Kit JSON previews as the default with a warning
      Given the user writes a Block Kit template whose output is not valid JSON
      When the preview renders
      Then the default Slack notification is previewed instead
      And the operator is warned that the template fell back to the default

    Scenario: Test fire sends a banner-marked notification before saving
      Given the user has configured a notification with a destination
      When the user test-fires the automation before saving it
      Then a notification is delivered to the configured destination
      And it is unmistakably marked as a test fire

    Scenario: Test fire is unavailable until a destination is configured
      Given the user has not yet set a destination
      Then test fire is unavailable

  Rule: Saving persists the whole automation at once

    Scenario: Saving a fully configured automation creates it
      Given the user has completed every required section
      When the user saves
      Then the automation is created and appears in the automation list

    Scenario: An invalid template blocks saving
      Given the user has written a template with invalid syntax
      When the user saves
      Then saving is blocked with the template error
      And no template change is persisted

    Scenario: Abandoning the drawer persists nothing
      Given the user has partially configured a new automation
      When the user closes the drawer without saving
      Then no automation is created

  Rule: Editing reuses the same staged drawer

    Scenario: Editing an existing automation pre-fills every section
      Given an existing email automation
      When the user edits it
      Then the same staged drawer opens with the identity, conditions, configuration, cadence, debounce, and templates pre-filled

  Rule: The settings list shows dispatch health

    Scenario: Last triggered and fired-count are available immediately
      Given automations exist in a project
      When the user opens the automation settings list
      Then each row shows the last-triggered timestamp and total fired count

    Scenario: Pending and failed counts reflect durable intent delivery
      Given a notification automation has durable dispatch intents
      When the user opens the automation settings list
      Then each notification row shows pending, failed, and dead counts

    Scenario: Template-health warnings surface on the per-automation panel
      Given a notification dispatched with a custom template that fell back to the default
      When the user opens the automation's detail panel
      Then the panel shows the template-error warning
      And the panel shows any missing variable names from that dispatch
