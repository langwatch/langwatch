Feature: HTTP agent body template editor
  As someone writing an HTTP agent's request body
  I want a placeholder such as {{messages}} left alone by the editor
  So that a valid template is not drawn as an error

  @integration
  Scenario: A body template with a placeholder shows no error squiggle
    Given an HTTP agent whose Content-Type is JSON and whose body is {"messages": {{messages}}}
    When I open the body template editor
    Then it colours the text as JSON
    And it draws no validation markers over the placeholder
