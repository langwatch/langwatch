Feature: Pairwise compare — promote winner to prompt versioning
  # Issue: #5104
  # Parent epic: #5099
  # Depends on: #5100 (pairwise MVP), #5101 (N-way select_best)
  #
  # After a pairwise / N-way eval shows a clear winner, one click pins
  # that variant's prompt as the new production version, with an audit
  # trail back to the eval that produced the decision. Wires the existing
  # AggregateHeaderBar onPromote callback hook into the existing
  # prompts.assignTag tRPC mutation — no new endpoint.

  Background:
    Given an EvaluationsV3 experiment with prompt targets ("variant_a", "variant_b")
    And both targets carry promptId and promptVersionId
    And the user has the "prompts:update" project permission
    And a pairwise eval has produced verdicts: variant_a wins 12, variant_b wins 7, ties 2
    And the active project has the built-in "production" tag

  Scenario: Promote button hidden behind tooltip when win rate is below threshold
    Given variant_b's win rate is 7 / 21 (33%)
    When I view the aggregate header bar
    Then the "Promote variant_b" button renders disabled
    And hovering it shows "Win rate too close to tie to promote (need ≥60%)."
    And clicking it does NOT open the confirmation modal

  Scenario: Promote button enabled when winner clears the threshold
    Given variant_a's win rate is 12 / 18 (67%)
    When I view the aggregate header bar
    Then the "Promote variant_a" button renders enabled
    And clicking it opens the confirmation modal titled "Promote variant_a to prod?"

  Scenario: Confirmation modal shows the prompt diff
    Given variant_a clears the threshold
    And the production tag currently points at promptVersionId "v_prod_old"
    When I click "Promote variant_a"
    Then the modal renders a diff comparing the current production version against variant_a's version
    And lines added by variant_a appear in green
    And lines removed appear in red

  Scenario: Confirmation modal shows the verdict summary
    Given variant_a clears the threshold
    And the eval ran against dataset "golden_set_v2"
    When I open the promote modal for variant_a
    Then the modal shows the text 'Won 12/18 rows on dataset "golden_set_v2" (67% win rate)'

  Scenario: Confirming sends the mutation with source metadata
    Given variant_a clears the threshold
    And the row-level eval cell id is "eval_abc"
    And the experiment id is "exp_xyz"
    When I click "Promote variant_a"
    And I click "Confirm promotion" in the modal
    Then the prompts.assignTag mutation is called with:
      | field                   | value                                          |
      | tag                     | production                                     |
      | source.kind             | pairwise-eval                                  |
      | source.evalId           | eval_abc                                       |
      | source.experimentId     | exp_xyz                                        |
    And a success toast "variant_a is now prod" appears

  Scenario: Audit trail chip appears on the prompt version history
    Given a previous run promoted variant_a's prompt version "v_new" via pairwise eval "eval_abc"
    When I open the prompt version history popover for variant_a's prompt
    Then the row for version "v_new" shows a "Promoted via pairwise eval" chip
    And clicking the chip navigates to the originating experiment view
    And hovering the chip reveals "Eval id: eval_abc"

  Scenario: Cross-org promotion is refused at the server
    Given the eval source experiment lives in project "other_project"
    And I am promoting a prompt that lives in project "my_project"
    When the assignTag mutation is invoked with that source
    Then the server returns a BAD_REQUEST with "Source experiment does not belong to this project."
    And no PromptTagAssignment row is upserted

  Scenario: Non-prompt targets cannot be promoted
    Given variant_a is an "agent" target with no promptId
    When I view the aggregate header bar
    Then the "Promote variant_a" button renders disabled
    And hovering it shows "Only prompt targets can be promoted. Workflow / HTTP / agent targets are not promotable in this version."

  Scenario: Authorization respected — viewer-only users get permission error
    Given the current user lacks the "prompts:update" project permission
    When the assignTag mutation is invoked
    Then the existing checkProjectPermission middleware rejects the call before the service runs
    And the user sees a permissions error toast on the client

  Scenario: prod_changed warning surfaced when prod moves mid-promote
    Given the modal opened while prod pointed at promptVersionId "v_prod_old"
    And another user moved the production tag to "v_prod_new" while the modal was open
    When I click "Confirm promotion" for variant_a's version
    Then the promotion still applies (last-write-wins)
    And the server response includes warning: "prod_changed"
    And a warning toast "Prod moved during your eval" appears alongside the success toast

  Scenario: Tie verdicts do not surface promote buttons above threshold
    Given the pairwise eval produced 10 ties, 5 wins for variant_a, 5 wins for variant_b
    And neither variant's win rate clears 60%
    When I view the aggregate header bar
    Then both "Promote" buttons render disabled with the threshold tooltip

  Scenario: N-way mode promote popover wires through the same flow
    Given a select_best eval with 4 variants (variant_a wins 60%+)
    When I open the "Promote ▾" popover
    And I click "variant_a" inside the popover
    Then the same confirmation modal opens
    And confirming runs the same prompts.assignTag mutation with source metadata
