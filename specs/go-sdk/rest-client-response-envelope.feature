Feature: Go SDK annotation responses
  A Go developer reading or writing annotations through the LangWatch SDK gets
  the annotation itself back, never the wrapper the API carries it in. When the
  API answers with something that holds no annotation at all, the developer is
  told so, rather than handed a blank one that looks real.

  Background:
    Given a Go program using the LangWatch REST client

  Rule: An annotation is returned, not its wrapper

    @unit
    Scenario: Listing every annotation returns the annotations
      Given the API returns two annotations
      When the developer lists annotations
      Then the SDK returns both annotations

    @unit
    Scenario: Fetching one annotation returns the annotation
      Given the API returns a single annotation
      When the developer fetches that annotation by id
      Then the SDK returns that annotation

    @unit
    Scenario: Listing a trace's annotations returns the annotations
      Given the API returns the annotations on a trace
      When the developer lists the annotations on that trace
      Then the SDK returns them

    @unit
    Scenario: Creating an annotation returns the created annotation
      Given the developer supplies a comment and a thumbs rating
      When the developer attaches an annotation to a trace
      Then the SDK returns the created annotation
      And both the comment and the rating reach the API

    @unit
    Scenario: Updating an annotation returns the updated annotation
      Given the developer supplies a comment and a thumbs rating
      When the developer updates an annotation
      Then the SDK returns the updated annotation
      And both the comment and the rating reach the API

    @unit
    Scenario: A project with no annotations yields an empty list
      Given the API returns no annotations
      When the developer lists annotations
      Then the SDK returns no annotations and no error

  Rule: An answer holding no annotation is reported, never invented

    Every field the SDK reads is optional as far as the decoder is concerned, so
    an answer in an unexpected shape parses happily and produces an annotation
    with every field blank. Returning that would be worse than returning
    nothing, because the caller cannot tell it apart from a real one.

    @unit
    Scenario: A read that carries no annotation fails
      Given the API answers a read in a shape that holds no annotation
      When the developer fetches an annotation by id
      Then the SDK reports the answer carried no annotation

    @unit
    Scenario: A list that carries no annotations fails
      Given the API answers a list in a shape that holds no annotations
      When the developer lists annotations
      Then the SDK reports an error rather than an empty list

    @unit
    Scenario: A write answered with an empty body fails
      Given the API accepts a write but returns nothing
      When the developer attaches an annotation to a trace
      Then the SDK reports an error rather than a blank annotation

    @unit
    Scenario: A rejected read is reported as not found
      Given the annotation does not exist
      When the developer fetches it by id
      Then the SDK reports it as not found
