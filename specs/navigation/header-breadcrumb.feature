Feature: Header breadcrumb flows from the workspace chip
  As a LangWatch user
  I want the workspace switcher chip and the page breadcrumb to read as one
  continuous path
  So that the header tells me where I am without visual noise

  Background:
    Given a signed-in user on a project page

  @bdd @ui @breadcrumb
  Scenario: The path reads chip, then crumbs
    Given the user is on the Experiments Workbench
    Then the header reads: workspace chip, separator, "Experiments",
        separator, "Experiments Workbench"
    And there is no extra "Dashboard" crumb before the section

  @bdd @ui @breadcrumb
  Scenario: Crumb separators are uniform
    Then every separator between the chip and the crumbs uses the same glyph
    And the chip's dropdown indicator is not doubled up with a separator

  @bdd @ui @breadcrumb
  Scenario: Parent crumbs navigate, the current page does not
    Given the user is on a page that has a parent section
    Then the parent crumb is a link to the section
    And the current page renders emphasized, as plain text

  @bdd @ui @breadcrumb
  Scenario: The project home shows no crumbs
    Given the user is on the project home
    Then only the workspace chip renders, with no trailing separators
