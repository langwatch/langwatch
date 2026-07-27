Feature: Test teardown cannot sweep the shared database
  As a developer running integration tests against the shared local database
  I want a broken test setup to produce a loud failure instead of a destructive cleanup
  So that one suite's failed beforeAll can never delete rows belonging to other suites and worktrees

  # Prisma drops `undefined` from a where clause rather than matching
  # nothing, so `deleteMany({ where: { id: teamId } })` with `teamId`
  # unassigned is `deleteMany({})`: every row in the table. Test ids are
  # typically `let` variables assigned inside `beforeAll`, which TypeScript
  # cannot verify across the callback boundary, so the value is undefined
  # exactly when setup already failed. See issue #6219.

  Rule: cleanup refuses a filter that no longer identifies anything

    @unit
    Scenario: An id that was never assigned
      Given a teardown entry whose id was never assigned
      When the cleanup runs
      Then it deletes nothing for that entry
      And it fails loudly, naming the model and the missing field

    @integration
    Scenario: Rows the suite did not create survive a broken setup
      Given rows created by someone else
      And a teardown whose ids were never assigned
      When the cleanup runs
      Then the other rows are untouched
      And the teardown fails loudly

    @integration
    Scenario: The identifiable entries are still cleaned
      Given a teardown where one entry has its id and another does not
      When the cleanup runs
      Then the identified rows are deleted
      And the unidentified entry deletes nothing
      And the teardown still fails loudly

    @unit
    Scenario: An empty id or empty list is refused
      Given a teardown entry whose id is an empty string, or whose id list lost every member to unassigned ids
      When the cleanup runs
      Then it deletes nothing for that entry
      And it fails loudly, naming the model and the field

    @unit
    Scenario: A list that arrived empty cleans nothing without failing
      Given a teardown entry whose id list was legitimately empty from the start
      When the cleanup runs
      Then it deletes nothing for that entry
      And nothing fails, because an empty list matches nothing rather than everything

    @integration
    Scenario: A fully identified teardown just cleans up
      Given a teardown whose ids were all assigned
      When the cleanup runs
      Then exactly the matching rows are deleted
      And nothing fails

  Rule: cleanup failures are never swallowed

    @integration
    Scenario: A delete that fails is reported, not hidden
      Given a teardown entry whose delete fails
      When the cleanup runs
      Then the remaining entries are still cleaned
      And the failure is reported loudly

  Rule: the dangerous form cannot merge

    @unit
    Scenario: A reassignable id in a raw delete fails the check
      Given a test file deleting rows filtered by a let-declared variable
      When the teardown check runs over it
      Then the file fails the check, naming the variable and the line

    @unit
    Scenario: A module constant in a raw delete passes the check
      Given a test file deleting rows filtered by a module-level constant
      When the teardown check runs over it
      Then the file passes the check

    @unit
    Scenario: An unfiltered delete fails the check
      Given a test file calling deleteMany with no filter at all
      When the teardown check runs over it
      Then the file fails the check
