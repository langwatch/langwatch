Feature: Task modules loader

  Deployments name extra task modules through LANGWATCH_TASK_MODULES, a
  comma-separated list of specifiers. Each module contributes tasks to the
  same catalogue the launcher resolves by name, whether it exports a plain
  array or builds its tasks from the process's own host.

  @unit
  Scenario: A plugin module exporting a plain task array loads
    Given a module that exports tasks: Task[]
    When the loader loads it
    Then its tasks are returned

  @unit
  Scenario: A plugin module exporting a host factory loads and receives this process's host
    Given a module that exports createTasks(host): Task[]
    When the loader loads it
    Then the factory is called with the process's own host
    And its tasks are returned

  @unit
  Scenario: Tasks from every named module are merged in order
    Given several modules named by LANGWATCH_TASK_MODULES
    When the loader loads them
    Then every module's tasks are merged in the order the modules were named

  @unit
  Scenario: A module with no recognizable export fails boot naming itself
    Given a module that exports neither tasks: Task[] nor createTasks(host): Task[]
    When the loader loads it
    Then it throws, naming the module

  @unit
  Scenario: A malformed task element fails boot naming the module
    Given a module whose tasks array holds a value that is not a Task
    When the loader loads it
    Then it throws, naming the module

  @unit
  Scenario: An unresolvable module fails boot naming itself
    Given a specifier that cannot be imported
    When the loader loads it
    Then it throws, naming the module
