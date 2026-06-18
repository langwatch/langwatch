Feature: Mapping source column types
  As a user mapping variables in the evaluations workbench
  I want dataset columns to keep their declared type in the mapping dropdown
  So that I can tell an image column from a text column at a glance

  Background:
    Dataset columns declare a type (text, number, image (URL), ...) when the
    dataset is created. The mapping dropdown shows each source column with a
    type icon and badge, so a column declared as image (URL) must surface as
    an image, not fall back to text.

  @integration
  Scenario: An image dataset column is badged as Image in the mapping dropdown
    Given the active dataset has a column of type image (URL)
    When I open the mapping dropdown for an input variable
    Then that column's option shows the Image type badge
    And it is not badged as Text

  @unit
  Scenario: An image variable derives an image column in the demonstrations editor
    Given a prompt node with an input variable of type image
    When the demonstrations editor derives its dataset columns from the node's fields
    Then the derived column keeps the image (URL) type
