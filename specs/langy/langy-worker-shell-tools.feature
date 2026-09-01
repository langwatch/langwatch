Feature: The worker box carries the shell tools the agent reaches for
  As an agent working through the worker's shell
  I want jq and python present under the names I call them
  So that a saved JSON answer can be narrowed without three failed commands

  # A production session read a 40 row experiment result, then tried to pick
  # out the failed rows three ways and lost all three:
  #
  #   langwatch ... --jq '[.results[] | {index, expected: .entry.l3}]'
  #     -> Invalid --jq expression: only a terminal "| length" pipe is supported
  #   jq ...      -> /bin/bash: jq: command not found
  #   python ...  -> /bin/bash: python: command not found
  #
  # `python3` was there the whole time. The CLI's built-in `--jq` is a small
  # subset on purpose, because it reads the answer before it is written to
  # disk. Anything past that subset belongs in the shell, so the shell has to
  # hold the tools.

  @unit
  Scenario: The worker image carries jq
    Given the langyagent runtime image package list
    Then it names "jq"

  @unit
  Scenario: The bare name python runs the interpreter
    Given the langyagent runtime image package list
    Then it names "python-is-python3"
    And an agent calling python reaches the same interpreter as python3

  @unit
  Scenario: The built-in filter names the shell tools when it is asked for more
    When an agent gives the CLI a --jq expression outside the supported subset
    Then the refusal says which subset is supported
    And the refusal names jq and python in the shell as the way to do more
