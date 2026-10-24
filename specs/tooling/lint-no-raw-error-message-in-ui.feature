Feature: The no-raw-error-message-in-ui lint rule
  A caught error's `.message` is not customer copy. Since #5984 the wire message of a handled
  error is its code slug, and an unhandled error can carry internals. Browser code reads the
  error through the shared helpers (`showErrorToast`, `<HandledErrorAlert>`, `describeError`),
  so the words come from the presentation registry keyed by code. The rule is syntactic: it
  reports a message read off a name known to be an error when it flows, in the same expression
  or through a direct const alias, into JSX, a toast call or a setter. A name known to be an error
  includes a const alias or cast of one (`const err = e as Error`); its message is also read when
  it is destructured (`const { message } = e`) or when the error itself is stringified
  (`String(e)`, `${e}`, `"x" + e`, `e.toString()`). A message wrapped in a call is
  followed: `trim(e.message)`, `humanize(err.message)`, `fn({ message: e.message })` and string
  methods such as `e.message.trim()` hand the message on. A react-hook-form field error is the
  form's own validation copy and is not a caught error, so a name read off `fieldState`,
  `formState.errors` or a field-error getter (`getMessageError(idx, "content")`) is not reported
  even when it is named `*Error`. Browser code means
  `modules/*/browser`, `enterprise/modules/*/browser` and `apps/ui`; tests are not governed.

  @unit
  Scenario: A catch parameter's message in JSX is reported
    Given a browser component that renders `error.message` of a caught error as a JSX child
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports rawErrorMessage

  @unit
  Scenario: A message in a JSX attribute is reported
    Given a browser component that passes `error.message` as a title or description attribute
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports rawErrorMessage naming the attribute

  @unit
  Scenario: A message in a toast is reported
    Given an `onError` callback or a `.catch` callback that passes its error's message to a toast
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports rawErrorMessage naming a toast

  @unit
  Scenario: A message stored with a setter is reported
    Given a browser file that calls a `set*` function with an error's message
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports rawErrorMessage naming the setter

  @unit
  Scenario: A react-query error and a direct alias are reported
    Given a browser component that renders `mutation.error.message`, the `error` of a hook result, or a const holding a message
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports rawErrorMessage for each

  @unit
  Scenario: An alias or cast of a caught error is still an error
    Given a browser file that writes `const err = e as Error` in a catch and renders `err.message`
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports rawErrorMessage on `err.message`

  @unit
  Scenario: A stringified caught error is reported
    Given a browser file that hands `String(e)`, `${e}`, `"x" + e` or `e.toString()` to a setter or JSX
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports rawErrorMessage for each

  @unit
  Scenario: A destructured message is reported
    Given a browser file that writes `const { message } = e` in a catch, or catches `({ message })`, and renders `message`
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports rawErrorMessage on `message`

  @unit
  Scenario: An error read through the shared helpers is accepted
    Given a browser file that passes the error to showErrorToast or describeError
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports nothing

  @unit
  Scenario: A message that is only compared or logged is accepted
    Given a browser file that calls a method on `error.message`, logs it, or reads `.message` of a non-error
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports nothing

  @unit
  Scenario: Files outside browser code are not governed
    Given a process file or a browser test that renders an error's message
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports nothing

  @unit
  Scenario: A shared package's component is governed like browser code
    Given a package file that renders an error's message
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports rawErrorMessage

  @unit
  Scenario: The mail templates' local preview is not governed
    Given the mail preview renders a render error's message to the developer
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports nothing

  @unit
  Scenario: A finding says what to do instead
    Given a browser file that renders an error's message
    When the no-raw-error-message-in-ui rule runs over it
    Then the message names showErrorToast and the code-keyed registry

  @unit
  Scenario: A typed failure value's text in JSX is reported
    Given a browser component that renders `run.error.message`, `queryError.message` or `result.error`
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports rawErrorMessage for each

  @unit
  Scenario: Recorded exceptions, field errors and a result's error outside JSX are accepted
    Given a browser component that renders a span's recorded exception or a form field's error, or toasts `result.error`
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports nothing

  @unit
  Scenario: A message handed to form.setError is reported
    Given a browser file that calls `form.setError(name, { message: error.message })` with a caught error
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports rawErrorMessage naming setError

  @unit
  Scenario: A message wrapped in a call is still reported
    Given a browser file that renders or stores `trim(e.message)`, `humanize(err.message)`, `fn({ message: e.message })` or `e.message.trim()`
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports rawErrorMessage for each

  @unit
  Scenario: A form field error named like a failure is accepted
    Given a browser file that renders `String(contentError.message ?? "")` where `contentError` was read off form state or a field-error getter
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports nothing

  @unit
  Scenario: A message that only goes through a check or the shared helpers is accepted
    Given a browser file that passes `error.message` to `includes`, a logger, or only the error itself to `describeError`
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports nothing

  @unit
  Scenario: A scenario hook result's error is the customer's own text and is accepted
    Given a browser component whose `result` is typed as a scenario hook result and renders `result.error`
    When the no-raw-error-message-in-ui rule runs over it
    Then it reports nothing
    And a caught error's message in the same file is still reported
