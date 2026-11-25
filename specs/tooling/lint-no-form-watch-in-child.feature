Feature: The no-form-watch-in-child lint rule
  `form.watch()` subscribes the calling component to every change of the whole
  form. Only the component that owns the form may do that; a component that
  receives the form as a prop reads one value with `useWatch({ control, name })`.

  @unit
  Scenario: Watching a form received as a prop is reported
    Given a browser component that receives form as a prop and calls form.watch
    When the no-form-watch-in-child rule runs over it
    Then it reports watchOnReceivedForm on each watch call's line

  @unit
  Scenario: Watching the form a component owns is left alone
    Given a browser component that creates its form with useForm and watches it
    When the no-form-watch-in-child rule runs over it
    Then it reports nothing
