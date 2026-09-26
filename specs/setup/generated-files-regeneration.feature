Feature: Regenerating generated files on a fresh checkout
  As a contributor opening a fresh clone or worktree
  I want one obvious command that generates the missing files
  So that my first typecheck does not read as broken code

  # Generated clients are not committed, so a checkout without them fails
  # typecheck with hundreds of "Cannot find module" errors. The generator
  # chain lives in the app package under `start:prepare:files`, while setup
  # guidance has used both that name and the root's `prepare:files`; both
  # names resolve from the repository root so no reference points at a
  # script that is missing where it runs.

  @unit
  Scenario: Both documented names reach the same generator chain
    Given the repository root and the app package each expose a prepare script
    When either documented name is invoked from the repository root
    Then both names route to the app package's generator chain

  @unit
  Scenario: The app keeps the generator chain its build calls by name
    Given the app build and development scripts call their generator chain by name
    When the app package scripts are read
    Then the chain still sits under the name those scripts invoke

  @unit
  Scenario: Setup guidance names a script that exists where it says to run it
    Given contributing documentation tells a newcomer how to generate the files
    When every command that guidance names is looked up in the scripts it targets
    Then each command resolves without a missing-script error
