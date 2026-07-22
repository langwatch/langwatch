Feature: Automation suggestions from project activity

  The page seeds itself with suggestions computed from what actually
  happened in the project — gaps between recent activity and the rules
  that exist. Suggestions are deterministic facts with a pre-filled rule
  attached, so accepting one is a review, not a chore. Suggestions earn
  attention by being right: they are few, dismissible, and never louder
  than the user's own rules.

  See dev/docs/adr/063-automations-domain-packages-customer-api-and-agent-surface.md.

  Background:
    Given a project with recent traffic

  Rule: Suggestions surface real gaps

    Scenario: An error spike with no alert suggests an error alert
      Given error rates spiked in the recent period
      And no active rule alerts on errors
      Then the page suggests an error alert citing how often it spiked

    Scenario: Failing evaluations going nowhere suggest a collection rule
      Given traces failed evaluations in the recent period
      And no rule collects failing traces into a dataset or review queue
      Then the page suggests collecting them, citing the count

    Scenario: Growing spend with no cost alert suggests one
      Given model spend grew substantially against the previous period
      And no active rule alerts on cost
      Then the page suggests a cost alert

    Scenario: A covered gap is not suggested
      Given error rates spiked in the recent period
      And an active rule already alerts on errors
      Then no error-alert suggestion is shown

  Rule: Suggestions stay quiet

    Scenario: The populated page shows at most one suggestion
      Given several suggestions apply to the project
      When the user views the populated page
      Then only one suggestion row is shown

    Scenario: The empty page may show more
      Given the project has no rules and several suggestions apply
      Then up to a few suggestions are shown beneath the outcome cards

    Scenario: Dismissing a suggestion keeps it away
      When the user dismisses a suggestion
      Then it does not return on later visits
      And other suggestions may take its place

  Rule: Accepting a suggestion is a review, not a blank form

    Scenario: Setting up a suggestion opens a pre-filled plan
      When the user sets up a suggestion
      Then composing opens with the suggested rule already filled in
      And the user approves or adjusts it like any composed plan
