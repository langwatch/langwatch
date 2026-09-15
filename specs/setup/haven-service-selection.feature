@unit
Feature: haven service selection
  Which services a worktree runs is a sticky, visible, per-worktree choice
  expressed as deltas on up — not an env-var incantation. See ADR-064.

  # Bound by Go tests in tools/thuishaven (`go test ./...`): domain/selection_test.go
  # (defaults, deltas, the status line), app/restart_test.go (reconcile, recovery,
  # per-worktree stickiness), app/plan_test.go (the workers lane), and
  # cmd/root_test.go (the removed env vars). The parity checker binds them by the
  # `// @scenario` annotations above each test func.

  Background:
    Given a worktree with a registered haven stack

  Scenario: A fresh worktree starts lean
    Given a worktree that has never been up
    When the developer runs "haven up"
    Then the stack runs the three Node lanes (ui, api, workers), nlp, gateway, and the idp simulator
    And langy is not started
    And neither developer tool is started
    And the first up prints the selection and how to change it

  Scenario: Adding a service is one word and it sticks
    When the developer runs "haven up +langy"
    Then langy starts as part of this stack
    And a later plain "haven up" in this worktree includes langy

  Scenario: Removing a service is the same shape
    Given nlp is part of this worktree's selection
    When the developer runs "haven up -nlp"
    Then nlp is stopped and leaves the selection
    And the nlp hostname resolves to the shared baseline stack instead of dead-ending

  Scenario: Up reconciles a running stack
    Given the stack is running without langy
    When the developer runs "haven up +langy"
    Then the running stack is replaced in place with langy included
    And the attached log view opens on langy's group
    And there is never a refusal
    And a plain "haven up" on a stack that matches its selection changes nothing

  Scenario: Up recovers a half-dead stack without a force flag
    Given the registry says the stack is running but its launcher has died
    When the developer runs "haven up"
    Then the stale state is cleaned up and the stack starts

  Scenario: Selection is per-worktree
    Given worktree A selected +langy and worktree B did not
    When both run "haven up"
    Then A runs langy and B does not

  Scenario: Status shows the selection
    When the developer runs "haven status"
    Then the report names the selected services and their health
    And names the services not selected, each with the exact "+svc" to add it

  # The workers lane stopped being selectable when the background worker became
  # its own application: every stack runs it, so ±workers has nothing to pick.
  # It is refused BY NAME rather than falling into the generic "unknown service"
  # error, which reads as a typo. See specs/setup/dev-process-topology.feature.
  Scenario: A retired service delta is refused by name
    When the developer runs "haven up +workers" or "haven up -workers"
    Then the command is refused
    And the refusal says the background worker is its own process now

  Scenario: Removed selection env vars name their replacement
    Given the developer still has "LANGWATCH_SKIP_NLP=1" set from before
    When they run "haven up"
    Then the command fails instead of starting a stack
    And the error says the variable no longer selects services
    And it names the one command that replaces it, "haven up -nlp"

  # Neither worker variable describes a topology this repository still has, so
  # both are refused on ANY value rather than only the one that used to change
  # what ran, and neither refusal offers a replacement — there is none.
  Scenario: A knob nothing reads is refused whichever way it is set
    Given the developer still has "WORKERS_IN_PROCESS" or "START_WORKERS" set from before
    When they run "haven up"
    Then the command fails instead of starting a stack
    And the error says the variable no longer does anything, naming no replacement

  # Every consumer outside haven spells truthiness differently, so matching one
  # literal lets the others through — and letting one through means running a
  # service the developer believes they turned off, which is what this whole
  # mechanism exists to prevent. Bound by cmd/root_test.go.
  Scenario: A removed selection variable is read for intent, not one spelling
    Given the developer wrote "WORKERS_IN_PROCESS=off" rather than "=0"
    When they run "haven up"
    Then it is refused exactly as "=0" would be
    And the same holds for "LANGWATCH_SKIP_NLP=yes" as for "=1"
    And a variable blanked out to nothing carries no intent and blocks nothing

  # The sticky selection is a file on disk that a developer can open, and the
  # natural thing to hand-write in it is the service you want, not all four.
  # Decoded as a whole selection, everything unwritten reads as off. Bound by
  # adapters/fileregistry/store_test.go.
  Scenario: A selection file that names only some services keeps the defaults for the rest
    Given a hand-written selection file that turns langy on and says nothing else
    When haven reads the worktree's selection
    Then langy is on
    And gateway and nlp keep the defaults they would have had
    And a file that names no services at all is treated as never written

  Rule: Langy's isolation tier is decided before the stack is built

    # The tier is the isolation posture the Langy worker runs under, and it is
    # persisted on the stack, carried into the overlay, the plan, a restart and
    # the reconcile guard — so it is resolved once, up front, from the
    # developer's own choice and from the machine. On a laptop with no container
    # runtime the only alternative to the host tier was no manager at all, which
    # is a stack that looks healthy and answers no chat. Bound by
    # domain/langytier_test.go and app/langy_tier_test.go. See ADR-129.

    Scenario: No container runtime on a development machine runs langy on the host
      Given a development stack on a machine with no container runtime
      And the developer has not chosen an isolation tier
      When they run "haven up +langy"
      Then the worker runs on the host instead of langy being skipped
      And one line names the missing runtime, why the worker runs on the host, and how to refuse

    Scenario: A development machine with a container runtime keeps the sandbox
      Given a development stack on a machine that has a container runtime
      When they run "haven up +langy"
      Then the worker runs in the container with the per-worker sandbox on
      And nothing is said about the tier

    Scenario: A non-development stack with no container runtime keeps the sandbox
      Given a stack whose environment is not a development one
      And the machine has no container runtime
      When they run "haven up +langy"
      Then the tier stays the production-like one
      And langy is skipped with the host-access opt-in named, as before

    Scenario: An explicit isolation choice is never overridden by the machine
      Given the developer asked for a tier by hand
      When they run "haven up +langy" on a machine with no container runtime
      Then the tier they asked for is the tier they get
      And refusing host access explicitly keeps the sandboxed tier

  Rule: The developer tools are optional lanes, never product lanes

    # The design system's Storybook and the mail studio are tools a developer
    # opens, not services the application talks to: nothing in the product
    # degrades when they are absent. So they stay in their own packages
    # (@langwatch/design-system, @langwatch/mail) and haven runs them the way it
    # runs langy — off by default, added by name, sticky from then on. Bound by
    # domain/devtools_test.go and app/plan_devtools_test.go.

    Scenario: The developer tools are off until a worktree asks for them
      Given a worktree that has never been up
      When the developer runs "haven up"
      Then the design-system Storybook is not started
      And the mail studio is not started
      And the status line names each one with the exact "+svc" that adds it

    Scenario: Adding both developer tools is one command and it sticks
      When the developer runs "haven up +design-system +mail-room"
      Then the design-system lane and the mail-room lane start as part of this stack
      And a later plain "haven up" in this worktree still runs both

    # The lanes used to be called "storybook" and "mail"; the old names are
    # refused by name, naming the flag that replaced each one, the same way
    # "haven up ±workers" is refused.
    Scenario: A renamed developer-tool lane is refused by its old name
      When the developer runs "haven up +storybook"
      Then the command is refused, naming "+design-system" as the replacement
      When the developer runs "haven up +mail"
      Then the command is refused, naming "+mail-room" as the replacement

    Scenario: A selected developer tool is reached by hostname
      Given a worktree running both developer tools
      Then the Storybook is served at "design-system.<slug>.langwatch.localhost"
      And the mail studio is served at "mail-room.<slug>.langwatch.localhost"
      And each is healthy once its root answers
      And "haven logs design-system" shows that lane's own output

    # The application already frames the Storybook at /design-system and starts
    # one itself on the first visit unless something already answers on the port
    # it derives. Handing it haven's port is what stops a second Storybook
    # building the same stories beside the one the stack is already running.
    Scenario: The application frames the Storybook the stack is already running
      Given a worktree running the Storybook lane
      When someone opens "/design-system" in the application
      Then the page frames the Storybook haven supervises
      And no second Storybook is started

    # A stack missing one of the three Node lanes serves pages and quietly
    # processes no jobs. Neither developer tool can be mistaken for one of them.
    Scenario: A developer tool is not one of the three Node lanes
      Given a worktree running both developer tools
      When a reader asks which Node lanes the stack supervises
      Then the answer is still ui, api and workers
      And neither developer tool appears among them

    # A worktree's .haven.json may predate the rename and still carry the old
    # "storybook" / "mail" keys. Losing that on read would silently turn a lane
    # back off for every worktree that had turned it on. Bound by
    # adapters/fileregistry/store_test.go.
    Scenario: A stored old-name developer-tool selection migrates on load
      Given a worktree's selection file states "storybook" and "mail" from before the rename
      When haven reads the worktree's selection
      Then both developer tools read back on
      And the next write replaces the old keys with "design-system" and "mail-room"
