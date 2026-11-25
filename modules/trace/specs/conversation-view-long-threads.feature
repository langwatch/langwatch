Feature: A long conversation in the trace drawer shows its turns

  From twelve turns on, the drawer's conversation view renders its turns through
  a virtualizer. The view once kept the empty row list from its first render,
  because the React Compiler cached its reads of the stable virtualizer, so a
  long conversation showed no turns at all.

  @integration
  Scenario: A long conversation shows its turns once the view has measured itself
    Given a conversation with fifteen turns is open in the trace drawer
    When the conversation view has measured its viewport
    Then it renders the turns that fit the viewport rather than an empty list
