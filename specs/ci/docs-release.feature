Feature: Docs release survives a moving main
  The docs release busts the docs site cache by rewriting one redirect in
  docs/docs.json and pushing that commit to main. Merges land while it runs,
  so a push made from the commit it checked out was refused as out of date.

  @unit
  Scenario: The docs release rewrites the redirect on the newest main
    Given a merge landed on main after the release checked out
    When the docs release runs
    Then it pushes the rewritten redirect on top of that merge

  @unit
  Scenario: The docs release retries a push that lost the race
    Given main refuses the release's first push
    When the docs release runs
    Then it starts again from the newest main and pushes on a later attempt

  @unit
  Scenario: The docs release fails once every attempt lost the race
    Given main refuses every push the release makes
    When the docs release runs
    Then it fails with an error and main is left as it was
