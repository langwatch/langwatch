Feature: Langy worker pre-warm on panel open
  Opening the Langy panel is the strongest signal a message is coming. The
  worker cold start (spawn the agent process, lay out its home, load skills) is
  the slowest part of the first turn, and today it only begins once the first
  message arrives. Pre-warm moves that boot into the seconds the user spends
  typing: the panel open asks the control plane to warm the conversation's
  worker, and the first message finds it already running.

  The warm resolves the SAME credential surface a turn would, configured or
  picked model, GitHub capability under the daily PR cap, egress allow-list,
  mirror tier, harness, because the worker signature is made of exactly those
  parts. A warm under a different signature boots a worker the first turn
  cannot reuse, which is worse than no warm at all.

  A warm is an optimisation, never a promise. Every failure on the warm path
  degrades to the cold start the user would have had anyway, and none of it is
  ever shown to the user.

  Background:
    Given a project with Langy enabled
    And a user who holds the langy:create permission in that project

  Rule: Opening the panel warms the worker before the first message

    @unit
    Scenario: Opening the panel warms the worker for a new conversation
      Given the Langy panel is closed and no conversation is active
      When the user opens the panel and the model configuration has resolved
      Then the control plane is asked to warm a worker exactly once
      And the request carries the model the composer's picker shows

    @unit
    Scenario: Selecting a recent conversation warms its worker
      Given the panel is open on one conversation
      When the user selects another conversation from the recents list
      Then the control plane is asked to warm the worker for the selected conversation

    @unit
    Scenario: A user without Langy never triggers a warm
      Given Langy has not been rolled out to the user
      When the panel surface mounts
      Then no warm request is sent

  Rule: The warm mints the conversation id the first message adopts

    @unit
    Scenario: A warm for a fresh chat returns a server-minted conversation id
      Given no conversation is active in the panel
      When the warm request completes
      Then the response carries a new conversation id
      And the panel holds it as the pending conversation, not the active one

    @unit
    Scenario: The first message adopts the warmed conversation
      Given the panel holds a pending conversation id from a warm
      When the user sends the first message
      Then the turn is started under that conversation id
      And the turn reuses the warmed worker instead of spawning a new one

    @unit
    Scenario: A conversation id that cannot be adopted never warms
      Given a caller supplies a conversation id with an invalid shape
      When the warm request is handled
      Then no worker is warmed
      And the caller is told nothing failed

  Rule: A warm mints a session key only when no live worker matches

    @unit
    Scenario: A warm that finds a live matching worker mints nothing
      Given a worker with the turn's exact signature is already running
      When the warm request is handled
      Then no session key is minted
      And no warm is dispatched to the manager

    @unit
    Scenario: A warm with no live worker mints a key and spawns
      Given no worker is running for the conversation
      When the warm request is handled
      Then the control plane mints a session key for that user and project
      And the manager is asked to warm a worker carrying that key

    @unit
    Scenario: The warm carries the same GitHub capability the turn would
      Given the user has reached the daily GitHub PR cap
      When the warm request is handled
      Then the warmed worker carries no GitHub token
      And the warm probe asks for a worker without GitHub capability
      # so the first turn, which strips the token the same way, still
      # matches the warmed worker's signature and reuses it

  Rule: Warm failures are invisible to the user

    @unit
    Scenario: A user whose role cannot carry Langy scope sees nothing
      Given minting a session key for the user fails because no Langy scope applies
      When the warm request is handled
      Then the warm reports it warmed nothing
      And the user sees no error
      # the first real message renders the proper scope refusal; the warm
      # must not front-run it with an unrequested error card

    @unit
    Scenario: A warm that fails outright degrades to a cold start
      Given the credential surface cannot be resolved
      When the warm request is handled
      Then the warm reports it warmed nothing
      And no error reaches the panel
      And the first message cold-starts the worker as if no warm existed

  Rule: An unused warm worker is reaped and its key dies with it

    # The reap itself is the manager's idle sweep, and the revoke-on-death plus
    # six-hour expiry backstop are specified in langy-session-key-lifecycle.
    # What the warm path owes that contract is the key ID: the manager can only
    # revoke a key it can name.
    @unit
    Scenario: The warm hands the manager what revocation needs
      Given no worker is running for the conversation
      When the warm spawns a worker with a freshly minted session key
      Then the warm credentials carry the minted key's id
      And when the idle reap kills the unused worker the manager revokes that key
      And a key the revoke never reaches still dies by expiry
