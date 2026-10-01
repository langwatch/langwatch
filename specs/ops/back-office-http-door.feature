Feature: The back office answers over HTTP

  Instance staff administer the product through `/api/admin` — starting and
  stopping an impersonation, and reading and writing the back-office resources
  the console lists. The behaviour is the Ops application's; what this describes
  is the door being open at all, and who it opens for.

  # The family was built and had no caller. Every route existed in the Ops
  # package and nothing in the API process mounted it, so impersonation and the
  # whole back office answered 404 — indistinguishable, from the outside, from
  # the hide the family performs for a caller who is not staff.
  #
  # That indistinguishability is why the door is left OFF rather than mounted
  # refusing when this deployment cannot answer it. A non-staff caller and a
  # deployment with no operator application both get nothing; an operator can
  # tell which by reading the boot report, and never by probing.
  #
  # Two session reads, and they are not the same question. Who is ACTING is
  # read as the impersonator where there is one, so an admin part-way through
  # an impersonation stays the person a write is attributed to. The raw auth
  # session is the row an impersonation is started and stopped against, and a
  # request whose cookie has since expired has an actor and nothing to attach
  # to.

  @integration
  Scenario: The back office is reachable on a deployment that composed it
    Given the deployment composed an operator application and a browser-session transport
    When the process mounts its REST families
    Then `/api/admin` answers

  @integration
  Scenario: A deployment with no browser session leaves the door off
    Given the deployment composed no browser-session transport
    When the process mounts its REST families
    Then `/api/admin` is not mounted at all rather than mounted refusing

  @integration
  Scenario: An impersonating admin stays the acting person
    Given a signed-in admin who is currently impersonating another person
    When the back office resolves who is acting
    Then the admin is the actor rather than the person being impersonated

  # The door was mounted and answered 404 to everybody. `ADMIN_EMAILS` names the
  # instance staff, and the API process never read it: only the background one
  # bound the variable, so the allow-list the back office matches against was
  # empty on every deployment and every operator got the hide meant for someone
  # who is not staff.
  @integration
  Scenario: The deployment's operator list reaches the back office
    Given the deployment names its instance staff in its own configuration
    And the host composing the process states no operator list of its own
    When the process resolves who its operators are
    Then the configured addresses are the ones the back office matches against

  @integration
  Scenario: A signed-in person who is not staff cannot tell the door exists
    Given a signed-in person the operator application does not recognise as staff
    When they ask the back office for a resource
    Then the answer is the same nothing an unmounted door would give

  @integration
  Scenario: Every back-office resource the console lists answers
    Given a signed-in member of instance staff
    When the console reads users, organizations, projects and subscriptions
    Then each one answers with the list the console renders
    And each one answers at the versioned address as well as the bare one
