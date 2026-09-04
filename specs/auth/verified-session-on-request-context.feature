Feature: A verified browser session reaches the request context

  The API process verifies the browser's cookie, resolves the whole session
  behind it, and then hands the request policy the caller's id alone. Every
  packaged tRPC surface that RENDERS the signed-in person — their name, their
  picture, the administrator acting as them — reads `ctx.session`, finds
  nothing, and refuses a caller the same process verified a millisecond
  earlier.

  The rule: authentication resolves one fact, and both halves of the request
  read it. Authorization decides on `user.id`; the surfaces that render the
  person read the rest of the same session. A caller with no cookie, or with a
  cookie no live session answers, stays anonymous to both halves.

  Finding F1 of `dev/docs/plans/e2e-walk-2026-09-04.md`.

  @integration
  Scenario: A verified browser session reaches the surfaces that render the person
    Given a browser session this process has verified
    When the caller lists the organizations they belong to
    Then the organization service is asked for that person's organizations
    And the caller is not refused as anonymous

  @integration
  Scenario: An impersonated session reaches the surface as the impersonated person
    Given an administrator is acting as another person
    When the caller lists the organizations they belong to
    Then the organization service is asked for the impersonated person's organizations
    And the real administrator travels beside them

  @integration
  Scenario: An anonymous caller stays refused by the same surface
    Given a request carrying no browser session
    When the caller lists the organizations they belong to
    Then the caller is refused as unauthorized
    And the organization service is never asked
