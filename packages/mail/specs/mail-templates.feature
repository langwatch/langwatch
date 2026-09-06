Feature: The transactional messages LangWatch sends

  Every message a person receives from LangWatch is one registered template: a
  props schema, named fixtures, a subject line and a component. The registry is
  what the preview studio reads and what a person reads to find out what we
  actually send, so a template that is not in it does not exist as far as either
  is concerned.

  All of them are built in one shell, in the expressive design system — the
  marketing site's language, not the application's — because they are read
  outside the product by somebody who is usually not signed in.

  Background:
    Given the mail template registry

  @unit
  Scenario: A template that is not registered is caught
    Given a template component file under the templates folder
    When the registry is compared against the folder
    Then every template file is listed in the registry

  @unit
  Scenario: Every fixture renders an email
    When each template is rendered from each of its fixtures
    Then the rendering completes without failing

  @unit
  Scenario: Every rendered email carries a subject line
    When each template is rendered from each of its fixtures
    Then a non-empty subject line comes back with it

  @unit
  Scenario: Every link the props carry reaches the reader
    When each template is rendered from each of its fixtures
    Then every link address in the props appears in the rendered email

  @unit
  Scenario: Every rendered email has a plain text alternative
    When each template is rendered from each of its fixtures
    Then a non-empty plain text body comes back with it

  @unit
  Scenario: The rendered email is pinned, because the output is the product
    When each template is rendered from each of its fixtures
    Then the rendered email matches the stored snapshot

  @unit
  Scenario: Props that do not match the schema are refused
    Given props missing a field the template needs
    When the template is asked to render them
    Then it refuses rather than rendering an email with a gap in it

  @unit
  Scenario: Every email offers a dark colour scheme
    When each template is rendered from each of its fixtures
    Then the email declares that it supports both colour schemes
    And it carries a dark rule for every surface it paints

  @unit
  Scenario: Every email carries the LangWatch wordmark
    When each template is rendered from each of its fixtures
    Then the wordmark is present with the brand name as its alternative text

  @unit
  Scenario: No email is dressed in the application's design system
    When each template is rendered from each of its fixtures
    Then the application's own accent colour appears nowhere in it
