Feature: What a process hands its modules

  A process composes modules from the members it holds, the peers it hands in
  and the repository tier it chooses in code.

  @unit
  Scenario: A process hands a module one peer by its token
    Given a process that answers for a peer itself and hands it in by its token
    When a module that depends on that peer boots
    Then the module is given the very instance the process handed in, unwrapped
    And the same token handed in twice is refused at the second call, naming the token

  @unit
  Scenario: A peer handed in and a module that provides it
    Given a process hands in a peer by its token
    And a module installed beside it provides the same token
    When the process boots
    Then it refuses to boot rather than choosing one

  @unit
  Scenario: Memory is a choice a caller makes in code
    Given a caller asks for a module's memory repositories in code
    When the process boots
    Then the module's memory tier is built and no store client is asked for
    And a module that declares no repositories has no memory tier to ask for, and says so

  @unit
  Scenario: A task binder is handed its module's parsed config
    Given a module that declares a config slice and builds its tasks with a binder
    When a process with the "tasks" role boots with that module's config stated
    Then the binder is handed the module's parsed config beside its app
