Feature: `pnpm dev` starts the Langy agent manager
  As a developer who wants to use Langy in the app I am running
  I want the agent manager to come up with the rest of the stack
  So that a chat with Langy answers instead of stopping mid-reply

  # Langy needs three parts: the app, the AI gateway, and the langyagent
  # manager. `pnpm dev` started the first two and not the third, so a chat
  # opened in a local app dispatched to a dead port, the turn was left to the
  # liveness subscriber, and the chat said "Langy stopped mid-reply". Nothing
  # in the app log names the missing service. The only local launcher was
  # haven, and only after `haven up +langy`.
  #
  # The manager is cheap enough to start every time: it opens no database
  # client, reads its embedded skills once, and sits at about 30 MB with no
  # measurable CPU. What is expensive is the per-conversation worker, about
  # 600 MB, and that is spawned when a person chats, not at boot. So the lane
  # starts the manager always and caps the pool to the local size, which keeps
  # the always-on cost near zero and bounds the cost of a chat.
  #
  # The lane follows the nlpgo lane, with two differences that come from
  # langyagent itself. It takes its listen port from PORT, which `pnpm dev`
  # already uses for vite, so the port has to be set for the lane instead of
  # inherited. And it fails fast without its secret and its two roots, so a
  # setup that is missing them must be skipped rather than started into a
  # restart loop.

  Background:
    Given a developer running the stack with `pnpm dev`

  Rule: The manager starts on the address the app dials

    # The launcher runs before every Node entry point and sees only the
    # calling shell, while the app loads platform/app/.env and then the
    # .env.portless haven overlay with override. A pinned agent URL is
    # therefore invisible to the launcher and authoritative for the app, the
    # same split the NLP engine had.

    @unit
    Scenario: The manager follows the address pinned in the app's env file
      Given platform/app/.env pins the agent URL to port 8080
      And this worktree runs on port slot 5590
      When the launcher resolves the agent address
      Then it resolves to the pinned port 8080
      And it says which file that came from

    @unit
    Scenario: The haven overlay wins over the plain env file for the agent address
      Given platform/app/.env pins one agent URL
      And the haven overlay pins another
      When the launcher resolves the agent address
      Then it resolves to the overlay's address, the one the app loads last

    @unit
    Scenario: An agent address pinned in a file beats one exported for a single run
      Given platform/app/.env pins the agent URL
      And a different address is exported into the shell
      When the launcher resolves the agent address
      Then it resolves to the pinned one, because that is what the app will read

    @unit
    Scenario: Nothing pinned leaves the launcher to derive the manager port slot
      Given no env file pins an agent URL
      When the launcher resolves the agent address
      Then it leaves the address unset for the launcher to derive from the port

    @unit
    Scenario: An overlay that clears the agent address is not read past
      Given platform/app/.env pins the agent URL
      And the haven overlay assigns it an empty value
      When the launcher resolves the agent address
      Then it derives the port slot, because the app reads the empty overlay too
      And it does not fall back to the address in the plain env file

    @unit
    Scenario: An overlay that clears the agent address drops one exported for a single run
      Given an agent URL exported into the shell
      And the haven overlay assigns the agent URL an empty value
      When the launcher resolves the agent address
      Then it derives the port slot, because the file beats the exported value

    @unit
    Scenario: A commented-out pin is not an agent address
      Given platform/app/.env has its agent URL commented out
      When the launcher resolves the agent address
      Then it leaves the address unset for the launcher to derive from the port

  Rule: The lane never takes the port the app is using

    # langyagent reads PORT for its own listen address and ignores SERVER_ADDR,
    # unlike the gateway and the NLP engine. `pnpm dev` exports PORT for the
    # app, so a lane that inherits it binds the port vite already holds and
    # dies with "address already in use" on every restart.

    @unit
    Scenario: The lane sets the manager's port instead of inheriting the app's
      Given the app runs on port 5570
      And no env file pins an agent URL
      When the launcher plans the langy lane
      Then the lane sets the manager's port to the derived slot
      And that port is not the app's port

    @unit
    Scenario: A pinned address decides the port the lane sets
      Given platform/app/.env pins the agent URL to port 8080
      When the launcher plans the langy lane
      Then the lane sets the manager's port to 8080

  Rule: A setup that cannot run the manager is skipped, never restarted forever

    # The lanes run under `concurrently --restart-tries -1`. A manager that
    # exits at boot for a missing secret is restarted for as long as the stack
    # is up, and its error scrolls the output of every other lane. Each of
    # these skips prints the one command that fixes it.

    @unit
    Scenario: A missing Langy env block skips the lane and names the doctor
      Given platform/app/.env has no LANGY_INTERNAL_SECRET
      When the launcher plans the langy lane
      Then the lane is skipped
      And the reason names the missing setting
      And it points at the Langy dogfood doctor

    @unit
    Scenario: A missing workspace root skips the lane the same way
      Given platform/app/.env has no LANGY_WORKSPACE_ROOT
      When the launcher plans the langy lane
      Then the lane is skipped
      And the reason names the missing setting

    @unit
    Scenario: A setting only the haven overlay carries does not count as present
      Given the Langy secret is only in the haven overlay, not in the app's env file
      When the launcher plans the langy lane
      Then the lane is skipped
      And the reason names the missing setting
      # The manager reads its settings from the app's env file alone, so a value
      # that lives only in the overlay would start a lane that cannot boot. The
      # agent address is resolved from the overlay on purpose, because the app
      # reads the overlay to decide where to dial.

    @unit
    Scenario: No Go toolchain skips the lane with the manual command
      Given the Go toolchain is not on PATH
      When the launcher plans the langy lane
      Then the lane is skipped
      And the reason gives the make command that starts the manager

    @unit
    Scenario: A manager already listening is reused
      Given another worktree already runs a manager on the resolved port
      When the launcher plans the langy lane
      Then the lane is skipped
      And the reason says the running manager is reused

    @unit
    Scenario: An external agent URL leaves the manager alone
      Given the agent URL points at a host that is not this machine
      When the launcher plans the langy lane
      Then the lane is skipped
      And the reason says the address is external

    @unit
    Scenario: The developer can opt out for one stack
      Given LANGWATCH_SKIP_LANGY is set
      When the launcher plans the langy lane
      Then the lane is skipped
      And the reason says the developer asked for it

  Rule: The lane names the worker binary the manager spawns

    # The manager spawns a separate binary for each conversation and looks for
    # it on PATH by name. A repo checkout does not put it there, so a manager
    # started without the path boots, accepts the dispatch, and fails the turn
    # with `exec: "langy-worker"`. The reader sees only "Langy stopped
    # mid-reply", which names neither the binary nor the build that makes it.

    @unit
    Scenario: The lane points the manager at the built worker in this checkout
      Given the launcher plans the langy lane
      When the lane is started
      Then the manager is told where the worker binary is
      And a path set in the environment still wins

    @unit
    Scenario: A worker binary that was never built is called out at startup
      Given the worker binary has not been built in this checkout
      When the launcher plans the langy lane
      Then the lane still starts, because the manager answers health checks
      And the startup line says which build command a chat needs first

  Rule: The worker finds the command names its model expects

    # The worker's model reaches for `python` on its own. macOS ships `python3`
    # only, so the first call fails and the model spends another turn and
    # another tool call finding that out. The name it expects goes on the
    # worker's PATH so the first call works.

    @unit
    Scenario: A machine with only python3 gets a python that runs it
      Given the machine has python3 and no python
      When the launcher plans the langy lane
      Then the lane puts a python on the worker's PATH
      And that python runs the python3 already installed

    @unit
    Scenario: A machine that has its own python is left alone
      Given the machine already has a python
      When the launcher plans the langy lane
      Then the lane adds nothing to the worker's PATH

  Rule: A local manager is capped to a local worker pool

    # The manager's defaults are the production ones: twenty workers, reaped
    # after ten idle minutes. On a laptop that is up to twelve gigabytes of
    # workers held for ten minutes after a chat ends. haven already caps its
    # own langy stack, and the `pnpm dev` lane uses the same numbers.

    @unit
    Scenario: The lane caps the pool and reaps idle workers quickly
      Given the launcher plans the langy lane
      When the lane is started
      Then the worker pool is capped to the local size
      And an idle worker is reaped in minutes rather than the production wait
      And the caps can still be overridden from the environment
