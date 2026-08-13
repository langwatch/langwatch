Feature: A laptop install only pays for what it uses
  As someone installing LangWatch on my own machine
  I want the install to skip the parts I am not going to use
  So that I am running the product in minutes instead of waiting on a download
    the size of the rest of the install put together

  See _shared/contract.md §1, the promise is "~3 minutes to the full stack".

  # Context. The evaluator environment installs every evaluator LangWatch can
  # run, and two dominate everything else: the PII detector ships a
  # natural-language model larger than the entire rest of that environment,
  # and language detection carries its own stack of language models. Almost
  # nobody installing LangWatch for the first time needs either, and the
  # people who do can say so.
  #
  # This is not about removing evaluators. It is about when they arrive, and
  # about the difference between "LangWatch cannot do this" and "this install
  # has not fetched it yet", a difference the product has to state out loud,
  # because a silently missing evaluator looks like a broken one.

  # ===========================================================================
  # The default install is the lean one
  # ===========================================================================

  Scenario: The heavyweight evaluators are not downloaded by default
    Given someone runs the installer for the first time
    When the evaluator environment is prepared
    Then the PII detector's language model is not downloaded
    And the language detection models are not downloaded
    And the install finishes materially faster than it would have with them

  Scenario: Every other evaluator still works
    Given a default install
    When they run any evaluator outside those two families
    Then it runs normally
    # Dropping some evaluators must not disturb the rest of the environment.

  Scenario: The install carries no build tooling at rest
    Given the installer has finished preparing the application
    When the server is running
    Then the application tree holds only what running it needs
    And the compilers, test runners, and linters that built it are gone
    # The production container image is built exactly this way: install
    # everything, build, then prune to runtime dependencies. A laptop install
    # deserves the same diet, and it is on the order of a gigabyte.

  # ===========================================================================
  # Absent is not the same as broken
  # ===========================================================================

  Scenario: Choosing the PII detector explains that it is not installed here
    Given a default install
    When they go to set up the PII detection evaluator
    Then the product tells them it is not installed in this install
    And it tells them exactly how to get it
    And it does not present the evaluator as though it were ready to run

  Scenario: Running it anyway fails with the same explanation
    Given a default install
    And an evaluation that uses the PII detector
    When it runs
    Then the failure says the evaluator is not installed in this install
    And says how to install it
    # Rather than the generic "internal error" a missing evaluator route
    # produces, which tells the person nothing they can act on.

  # ===========================================================================
  # Asking for it gets it
  # ===========================================================================

  Scenario: Turning it on installs it
    Given someone has asked for the PII detector
    When they restart the server
    Then its language model is downloaded once
    And the PII detection evaluator works
    And the product no longer says it is missing

  Scenario: Turning it back off does not break an install that used it
    Given an install that has the PII detector
    When they turn it off and restart
    Then the rest of the install keeps working
    And the product goes back to saying the evaluator is not installed here

  # ===========================================================================
  # An evaluator this install cannot run is named, never shrugged at
  # ===========================================================================

  # An evaluator can be absent for two reasons: this install skipped it, or it
  # was retired from the product entirely. Either way a saved evaluation can
  # still name it, and the question is the same one: what does the person who
  # opens that evaluation see. A blank page, an "internal error" or a silent
  # pass all mean the same thing to them, which is that the product will not
  # tell them what is wrong or what to do about it.

  @integration
  Scenario: An old evaluation that still names a retired evaluator offers a replacement
    Given an evaluation saved long ago that names an evaluator this install no longer has
    When they open its configuration page
    Then the page loads rather than failing
    And it names the evaluator that is no longer available
    And it offers the evaluators they can pick instead

  @unit
  Scenario: Running one fails naming the evaluator, not with an unknown error
    Given an evaluation saved long ago that names an evaluator this install no longer has
    When it runs
    Then the failure names the evaluator that could not be found
    And it is reported as a known failure rather than an unknown one

