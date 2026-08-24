Feature: The prompt list does work proportional to the prompts it returns

  A customer opening the scenario editor waited two seconds for the prompt
  list to answer. The list held 32 prompts and seven kilobytes of data; the
  time went into the copy counts, which were computed by aggregating every
  prompt on the platform on every call.

  So the list computes its copy counts from the listed prompts only, and it
  counts the copies that still exist. That is the set a push to copies can
  reach, so a prompt whose copies were all deleted no longer offers a push
  that has nowhere to go.

  Rule: The list reports how many live copies each prompt has

    @integration
    Scenario: A prompt with copies reports their number
      Given a prompt with a copy in each of two other projects
      When the prompts are listed
      Then the prompt reports two copies

    @integration
    Scenario: A deleted copy is not counted
      Given a prompt with two copies and one of them deleted
      When the prompts are listed
      Then the prompt reports one copy

    @integration
    Scenario: A prompt without copies reports zero
      Given a prompt that was never copied
      When the prompts are listed
      Then the prompt reports zero copies

  Rule: The prompt catalog does not delay other queries

    The catalog is regularly the slowest query on a screen. Batched with
    other calls it holds the whole shared request until it finishes, which
    is what kept the scenario editor blank behind it.

    @unit
    Scenario: The catalog query travels on its own request
      When a screen asks for the prompt catalog
      Then the request is sent unbatched
