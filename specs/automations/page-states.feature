Feature: Automations page — one page, four states

  The automations page is a single lifecycle surface: describe an intent,
  approve a plan, manage one list, respond to fires. Which state the page
  is in is derived from the project's rules — the user never picks a tab
  or a taxonomy. The page is called Automations; individual rows are
  rules.

  See dev/docs/adr/063-automations-domain-packages-customer-api-and-agent-surface.md.
  Related: specs/automations/authoring-drawer.feature (the detailed form the
  page links to as "Edit details") and
  langwatch/specs/automations/automations-list.feature (the prior list spec;
  its per-row facts and global fire-history surface carry forward).

  Background:
    Given a user on the automations page of their project

  Rule: The empty state asks for intent, not taxonomy

    Scenario: A project with no rules sees one question
      Given the project has no rules
      Then the page asks what should happen automatically
      And offers three outcomes in plain language: be told when a metric crosses a line, receive a recurring digest, and act on matching traces
      And offers a free-text way to describe the intent
      And no statistics, tabs, or kind pickers are shown

    Scenario: An outcome card starts a composing flow with the intent framed
      Given the project has no rules
      When the user picks the recurring-digest outcome
      Then composing starts already framed as a scheduled digest

  Rule: The populated state is one list where every rule reads as a sentence

    Scenario: All kinds live in one list
      Given the project has alert, schedule, and on-trace rules
      Then all rules appear in one list
      And each row leads with a status indicator and reads as a condition and its outcome
      And each row trails with its kind badge: Alert, Schedule, or On trace

    Scenario: The header summarizes health as prose
      Given no rule is firing
      Then the page header says all is quiet and names the next scheduled run
      And no stat cards are shown

    Scenario: Rows carry the detail that matters for their kind
      Then an alert row shows its health and when it last fired
      And a schedule row shows its next run
      And an on-trace row shows how many traces it matched recently

    Scenario: Filtering by kind
      When the user filters the list to alerts
      Then only alert rules are shown with their count

    Scenario: Sorting leads with what needs attention
      Given one rule is unhealthy and others are quiet
      Then the unhealthy rule sorts above the quiet ones
      And ties break by most recent activity

  Rule: The firing state turns the page into an incident view

    Scenario: A firing alert takes over the top of the page
      Given an alert rule is firing
      Then the firing rule is promoted above the list as an incident
      And the incident shows the current value, how long it has been firing, where it notified, and how often it fired recently
      And the incident offers to view the matching traces
      And the incident offers to silence the rule for an hour

    Scenario: Healthy rules step back during an incident
      Given an alert rule is firing
      Then the remaining rules are visually de-emphasized under a note that everything else is healthy

    Scenario: Recovery returns the page to quiet on its own
      Given the firing alert recovers
      Then the incident presentation clears without user action
      And the header returns to the quiet summary

  Rule: The new-rule entry always opens composing

    Scenario: The new-rule action opens composing regardless of state
      When the user chooses to create a new rule
      Then the composing flow opens
      And the detailed form remains reachable from composing for users who want every control

    Scenario: Editing an existing rule opens the detailed form pre-filled
      Given an existing rule
      When the user edits it
      Then the detailed form opens with every section pre-filled
