Feature: Reading other features from the trace ingestion path

  Four of the trace-ingestion subscribers reach outside Trace: the project
  metadata sync reads and writes a project, the evaluation trigger lists a
  project's monitors, record-time cost enrichment reads the project's own cost
  rules, and the first-trace milestone is a product-analytics event.

  Each of those was named as the whole upstream service, and each upstream
  service is ten to fourteen capabilities wide with its own persistence graph
  behind it. That is what kept these subscribers inside the application: a
  process that wanted one read had to be able to build all of them. Naming the
  actual capability makes each composable on its own, and the published service
  still satisfies it, so nothing upstream changes.

  @unit
  Scenario: The project metadata subscriber names three capabilities, not a service
    Given a process holding only a project read, a metadata write and an org-admin lookup
    When the project metadata subscriber is composed
    Then it runs without a full project service

  @unit
  Scenario: The published project service still satisfies the narrowed port
    Given the published project service
    When it is passed where the narrow port is expected
    Then every one of the three capabilities resolves through it

  @unit
  Scenario: The evaluation trigger names one monitor read
    Given a process holding only the enabled-on-message monitor listing
    When the evaluation trigger's monitor dependency is composed
    Then it lists monitors without a full monitor service

  @unit
  Scenario: Record-time cost enrichment reads the project's own cost rules
    Given a project with custom model cost rules
    When the cost catalog port is asked for them
    Then it answers the project's rules rather than a static catalog

  @unit
  Scenario: The first-trace milestone is recorded through a sink, not a function
    Given a process holding a product-analytics sink
    When the first-trace milestone is recorded
    Then it reaches that sink rather than a module-level function
