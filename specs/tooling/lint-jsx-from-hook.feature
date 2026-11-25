Feature: The jsx-from-hook lint rule

  Hooks return state and callbacks; components render. CLAUDE.md and
  dev/docs/best_practices/react.md both say so: a hook that returns JSX
  couples rendering to logic, hides the component tree from the reader, and
  makes both harder to test. A hook that needs to "render" something returns
  the state a consumer needs and lets that consumer render explicitly. Only a
  hook's own top-level return counts — a returned render callback belongs to
  a different function and is out of scope.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: a hook returning JSX is reported
    Given a production .tsx file whose use-named function returns a JSX element, directly or from one branch of a conditional
    When the jsx-from-hook rule runs over it
    Then it reports hookReturnsJsx
    And the message names the hook and tells the reader to move the JSX into the calling component

  @unit
  Scenario: a concise-arrow hook returning JSX is reported
    Given a production .tsx file whose use-named concise arrow's body is JSX, directly or from a conditional
    When the jsx-from-hook rule runs over it
    Then it reports hookReturnsJsx on the line of the JSX, naming each hook

  @unit
  Scenario: a hook returning state is left alone
    Given a production .tsx file whose use-named function returns an object of state and callbacks
    When the jsx-from-hook rule runs over it
    Then it reports nothing

  @unit
  Scenario: a hook returning a render callback is left alone
    Given a production .tsx file whose use-named function returns a callback that itself returns JSX
    When the jsx-from-hook rule runs over it
    Then it reports nothing
