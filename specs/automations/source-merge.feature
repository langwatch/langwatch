Feature: One automation flow with a subject choice

  Automation and alert merge into one flow. An automation watches something
  — a trace filter, or a graph — applies a rule, and delivers. There is no
  type card and no source card: the wizard opens by asking what to watch,
  and the rule shape follows the answer. Schedules stay a separate concept
  with their own tab and entry point. The wizard is three steps — Watch,
  Delivery, Review — linear to create, opening on the review overview to
  edit. Slack becomes a project-level integration: the bot token is
  configured once per project and rotated in one place, and the composer
  only ever asks for a channel. On the wire, "source" survives as a
  derived alias beside the unchanged kind discriminator; no screen shows
  the word.

  Every scenario here is @unimplemented: this file ships with the design
  (ADR-093) and enforces nothing until the reference implementation binds
  it, unit by unit, per the plan in the ADR's final section.

  See dev/docs/adr/093-automations-source-merge.md.

  Background:
    Given a user in a project

  Rule: One flow, one opening question

    The former Alert is an automation that watches a graph. The wizard's
    first step is the subject itself: a trace filter or a graph, with the
    subject configured inline. What a saved automation watches never
    changes, because the graph slot and the report calendar make the
    conversion a create plus a delete.

    @integration @unimplemented
    Scenario: The wizard opens by asking what to watch
      When the user starts creating an automation
      Then the first step asks what the automation should watch
      And it offers a trace filter and a graph
      And no type or source picker is shown

    @integration @unimplemented
    Scenario: Creating an automation that watches a trace filter
      When the user chooses to watch a trace filter
      And sets a condition, a delivery channel, and a name
      Then the review step shows what it watches, the rule, the delivery, and the name together
      And saving creates one automation that acts on matching traces

    @integration @unimplemented
    Scenario: Creating an automation that watches a graph
      When the user chooses to watch a graph
      And picks a graph, a series, and a threshold rule
      And sets a delivery channel and a name
      Then saving creates one automation that fires when the metric crosses the threshold

    @integration @unimplemented
    Scenario: The wizard keeps completed steps in view
      Given the user has completed the watch step
      When the user is on the delivery step
      Then the completed step shows a one-line summary
      And the user can return to it without losing later answers

    @integration @unimplemented
    Scenario: Watching a graph with no graphs offers a way forward
      Given the project has no custom graphs
      When the user chooses to watch a graph
      Then the step offers creating a graph
      And the step offers a template that ships with its own graph

    @integration @unimplemented
    Scenario: What a saved automation watches cannot change
      Given a saved automation that watches a trace filter
      When the user edits it
      Then the filter-or-graph choice reads as locked with an explanation
      And the filter itself remains editable
      And the wizard offers creating a new automation to watch something else

    @integration @unimplemented
    Scenario: Changing what an automation watches over the API is refused
      Given a saved automation that watches a graph
      When an API request changes its kind or source
      Then the request is refused with the machine-readable kind-immutable code
      And the stored automation is unchanged

  Rule: Editing opens on the overview, not on the watch step

    The lesson from the previous restructuring attempt: losing the overview
    while editing was the annoying part. Editing is hub-and-spoke — the
    review screen is home, and each section is edited alone.

    @integration @unimplemented
    Scenario: Editing an automation opens the review overview
      Given a saved automation
      When the user edits it
      Then the review overview opens with every section summarised

    @integration @unimplemented
    Scenario: Editing one section returns to the overview
      Given the user is editing a saved automation
      When the user opens the delivery section, changes the channel configuration, and finishes
      Then the review overview is shown again
      And the other sections are unchanged

    @integration @unimplemented
    Scenario: Abandoning an edit persists nothing
      Given the user is editing a saved automation
      When the user closes the wizard without saving
      Then the stored automation is unchanged

  Rule: One list for automations, whatever they watch

    Automations and alerts were two near-identical tables. They become one
    table whose columns say what each row watches and where it delivers.
    Schedules keep their own tab.

    @integration @unimplemented
    Scenario: The unified table lists automations watching filters and graphs together
      Given the project has an automation watching a trace filter and one watching a graph
      When the user opens the automations list
      Then both appear in one table
      And each row shows what it watches and where it delivers

    @integration @unimplemented
    Scenario: Filtering the list to graph-watching automations
      Given the project has automations watching filters and graphs
      When the user filters the list to graph
      Then only graph-watching automations are shown

    @integration @unimplemented
    Scenario: Schedules stay on their own tab
      Given the project has a schedule
      When the user opens the automations list
      Then the schedule is not in the automations table
      And the schedules tab lists it

  Rule: Slack is set up once per project

    The bot token lives on the project integration, encrypted, never
    returned to any client. The composer only picks a channel. Rotation
    happens in one place and needs no automation edits.

    @integration @unimplemented
    Scenario: Connecting Slack for a project
      Given the user can manage the project
      When the user connects Slack with a valid bot token in settings
      Then the integration shows the connected workspace by name
      And the token itself is never returned to the client

    @integration @unimplemented
    Scenario: A token Slack rejects is refused at setup
      When the user connects Slack with a token the workspace rejects
      Then the setup is refused with the machine-readable invalid-token code
      And no integration is stored

    @integration @unimplemented
    Scenario: The composer only asks for a channel
      Given the project has a Slack integration
      When the user configures Slack delivery in the wizard
      Then the user picks a channel from the connected workspace
      And no token field is shown

    @integration @unimplemented
    Scenario: Slack delivery without any token fails with a named cause
      Given the project has no Slack integration
      And an automation whose Slack delivery stores no token of its own
      When the automation fires
      Then the delivery fails with the machine-readable integration-missing code

    @integration @unimplemented
    Scenario: Rotating the token needs no automation edits
      Given the project has a Slack integration used by several automations
      When the user replaces the token in settings
      Then subsequent deliveries use the new token
      And no automation was edited

  Rule: An automation's own stored token outranks the project integration

    Existing automations carry their own encrypted token, possibly for a
    different workspace than the one the project later connects. Delivery
    never silently retargets: the automation's own token wins until it is
    explicitly cleared. The rotation gap that accepts is handled by
    visibility — every unmigrated token is flagged where the automation
    appears — never by silence.

    @integration @unimplemented
    Scenario: A legacy automation keeps delivering with its own token
      Given an automation that stores its own Slack bot token
      And the project also has a Slack integration
      When the automation fires
      Then the delivery uses the automation's own token

    @integration @unimplemented
    Scenario: An automation using its own token is flagged where it appears
      Given an automation that stores its own Slack bot token
      When the user sees it in the automations list or opens its drawer
      Then it says the automation uses its own Slack token
      And it offers switching to the project integration

    @integration @unimplemented
    Scenario: Switching a legacy automation to the project integration
      Given an automation that stores its own Slack bot token
      And the project has a Slack integration
      When the user chooses to use the project integration for it
      Then the automation's stored token is cleared
      And its next delivery uses the project integration's token

    @integration @unimplemented
    Scenario: Settings counts the automations still on their own token
      Given two automations that store their own Slack bot tokens
      When the user opens the Slack integration in settings
      Then it says two automations still use their own token

    @integration @unimplemented
    Scenario: New automations never store a token
      Given the project has a Slack integration
      When the user creates an automation with Slack delivery
      Then the saved automation stores no token of its own

  Rule: A use-case template ships with its graph

    Picking a template must save work: a graph-watching template carries a
    graph specification and creates the graph with the automation. It
    always creates a new graph — a graph can back only one automation, so
    reusing one the user already has an automation on would be refused.

    @integration @unimplemented
    Scenario: A graph-watching template creates its graph
      When the user picks the error spike template and saves the automation
      Then a new graph backing the automation is created
      And the automation's rule watches that graph

    @integration @unimplemented
    Scenario: A refused template save leaves no orphan graph
      Given the user picked a template that ships a graph
      When saving the automation is refused
      Then no graph was left behind

  Rule: Old kind-based API clients keep working

    The wire keeps kind as the discriminator; source is a derived alias
    published beside it, and it is wire vocabulary only — no screen shows
    the word. Neither field is scheduled for removal.

    @integration @unimplemented
    Scenario: Creating with the kind field still works
      When an API client creates an automation using only the kind field
      Then the automation is created
      And the response carries both the kind and the matching source

    @integration @unimplemented
    Scenario: Creating with the source field works
      When an API client creates an automation using only the source field
      Then the automation is created
      And the response carries both the source and the matching kind

    @integration @unimplemented
    Scenario: A mismatched kind and source pair is refused
      When an API client sends a kind and a source that disagree
      Then the request is refused with the machine-readable mismatch code
      And the response names both values it received
