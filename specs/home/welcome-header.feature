@unit
Feature: Welcome Header
  As a user
  I want to see a personalized greeting on the home page
  So that I feel welcomed and know I'm in the right place

  Background:
    Given I am logged in as a user

  Scenario: Displays greeting with user's first name
    Given my name is "John Doe"
    When I view the home page
    Then I should see "Hello, John"

  Scenario: Extracts first name from full name
    Given my name is "Jane Maria Smith"
    When I view the home page
    Then I should see "Hello, Jane"

  Scenario: Displays friendly fallback when name unavailable
    Given my name is not set
    When I view the home page
    Then I should see "Hello 👋"

  Scenario: Displays friendly fallback when name is just email
    Given my name is "johndoe@example.com"
    When I view the home page
    Then I should see "Hello 👋"
