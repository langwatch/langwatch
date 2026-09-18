Feature: The NLP engine `pnpm dev` starts is the one the app talks to
  As a developer running a worktree on its own port slot
  I want the engine the launcher starts and the address the app dials to agree
  So that the optimization studio and the prompt playground work without a
  second terminal or a hand-rolled port relay

  # `pnpm dev` starts the Go NLP engine itself, and the app reaches it at
  # LANGWATCH_NLP_SERVICE. The two ends resolve that address from different
  # places: the launcher is a shell script that runs first and sees only the
  # calling shell, while the app loads platform/app/.env (then the .env.portless
  # haven overlay) with override afterwards. A pinned address is therefore
  # invisible to the launcher and authoritative for the app.
  #
  # Left alone that splits the stack in half. Observed on a worktree at
  # PORT=5590 with .env pinning port 5571: the launcher derived 5591, started a
  # healthy engine there, and every playground run failed with "LangWatch NLP is
  # unreachable" because the app was dialing 5571 the whole time. Nothing in
  # either log says the two disagree, and the same split hits any worktree whose
  # port slot is not the one .env was written for.
  #
  # So the launcher resolves the address the way the app will, and prints what
  # it read. Nothing pinned still means the launcher's own derivation, PORT+1,
  # exported for the app to pick up.

  @unit
  Scenario: The engine follows the address pinned in the app's env file
    Given platform/app/.env pins the NLP address to port 5571
    And this worktree runs on port slot 5590
    When the launcher resolves the NLP address
    Then it resolves to the pinned port 5571
    And it says which file that came from

  @unit
  Scenario: The haven overlay wins over the plain env file
    Given platform/app/.env pins one NLP address
    And the haven overlay pins another
    When the launcher resolves the NLP address
    Then it resolves to the overlay's address, the one the app loads last

  @unit
  Scenario: An address pinned in a file beats one exported for a single run
    Given platform/app/.env pins the NLP address
    And a different address is exported into the shell
    When the launcher resolves the NLP address
    Then it resolves to the pinned one, because that is what the app will read

  @unit
  Scenario: Nothing pinned leaves the launcher to derive the port slot
    Given no env file pins an NLP address
    When the launcher resolves the NLP address
    Then it leaves the address unset for the launcher to derive from the port
    And it says nothing

  @unit
  Scenario: A commented-out pin is not an address
    Given platform/app/.env has its NLP address commented out
    When the launcher resolves the NLP address
    Then it leaves the address unset for the launcher to derive from the port
