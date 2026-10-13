Feature: The boot screen stays until the app draws a page
  As a reader opening any LangWatch page
  I want the boot screen held until the app has drawn something
  So that a slow session or project read never shows an empty page

  @unit
  Scenario: The theme provider's style and script do not count as a drawn page
    Given the boot screen is over the page
    When the theme provider writes only its style and script into the app's root
    Then the boot screen stays
    When the app draws a page into the root
    Then the boot screen leaves

  @unit
  Scenario: The boot screen's live ground carries no date and time polyfill
    Given the live ground script the boot screen inlines into every page
    When it is built
    Then it reads the wall clock without the Temporal polyfill
