Feature: Unattended Langy turns
  A module may start a Langy turn for a person who is not at the keyboard, such as a
  scheduled insights run. The turn acts as that person, with the permissions they hold
  when it starts, and it can only read: it holds no write permission and no GitHub token.
  Its conversation is the person's own, marked as a run, and it never notifies them.

  Rule: An unattended turn only reads

    @unit
    Scenario: An unattended turn's key holds view permissions only
      Given a person who may view, update and delete in a project
      When an unattended turn is started for them
      Then the key the worker gets holds their view permissions
      And it holds no permission whose action is not view

    @unit
    Scenario: An unattended key never carries more than the person holds
      Given a person who may view traces but not cost in a project
      When an unattended key is minted for them
      Then the key holds traces:view and no cost permission

    @unit
    Scenario: An unattended turn asks for no GitHub token
      Given a project with GitHub connected
      When an unattended turn is started for a person
      Then no GitHub token is asked for
      And the worker's credentials hold none

    @unit
    Scenario: An unattended turn never borrows a running worker's key
      Given a worker that answers as already running for the conversation
      When an unattended turn is started
      Then a read-only key is still minted for the turn
      And the turn's handoff carries that key

    @unit
    Scenario: A chat turn keeps the full ceiling and its GitHub token
      Given a project with GitHub connected
      When a person sends a chat turn
      Then the key is minted with every permission Langy may hold for them
      And the worker's credentials hold the GitHub token

  Rule: An unattended turn acts as the person, as they are now

    @unit
    Scenario: A person who no longer exists is refused an unattended turn
      Given a user id no user has
      When an unattended turn is started for it
      Then it is refused with langy_unattended_actor_missing
      And no turn is started

    @unit
    Scenario: A person without Langy access is refused an unattended turn
      Given a person Langy is not released to in the project
      When an unattended turn is started for them
      Then it is refused with langy_unattended_no_langy_access
      And no turn is started

    @unit
    Scenario: A person with no permission in the project is refused
      Given a person who holds no permission Langy may read with in the project
      When an unattended turn is started for them
      Then it is refused with langy_insufficient_scope
      And no conversation is started and nothing is sent to a worker

    @unit
    Scenario: A member whose role was removed gets no unattended key
      Given a member with the viewer role on a project
      And an unattended key minted for them holds view permissions only
      When their role is removed
      Then a new unattended key is refused for them
      And the key minted before is refused by the owner ceiling

    @unit
    Scenario: An aggregate project takes no unattended turn
      Given an aggregate project
      When an unattended turn is started in it
      Then it is refused with aggregate_project_is_read_only
      And no turn is claimed

  Rule: A run conversation is the person's own, and quiet

    @unit
    Scenario: An unattended turn starts a new conversation marked as a run
      Given a person with Langy access
      When an unattended turn is started for them with a title
      Then a new conversation is started for them with that title
      And the conversation's origin is run

    @unit
    Scenario: A run conversation keeps the title it was started with
      Given a run conversation started with a title
      When its first turn completes
      Then no title is generated for it

    @unit
    Scenario: A conversation started before origins existed is interactive
      Given a conversation started event stored without an origin
      When the event is folded
      Then the conversation's origin is interactive

    @unit
    Scenario: A run conversation shows in the person's history as a run
      Given a run conversation and a chat conversation of the same person
      When their conversations are listed
      Then the run conversation is listed with the origin run
      And the chat conversation with the origin interactive

    @unit
    Scenario: A finished run conversation sends no push notification
      Given a person who turned Langy notifications on
      When a long turn completes in a run conversation
      Then no push is requested
      And a long turn that completes in a chat conversation still requests one

  Rule: Unattended turns have their own window

    @unit
    Scenario: Unattended turns are counted apart from chat turns
      Given a project whose unattended turns reached their window
      When another unattended turn is started
      Then it is refused with langy_turns_rate_limited
      And a chat turn in the same project still starts

  Rule: The settled answer is handed back whole

    @unit
    Scenario: A settled turn answers its message id and parts
      Given a turn that completed with an answer
      When a caller waits for the turn to settle
      Then the settlement carries the answer's message id and its parts beside its text
