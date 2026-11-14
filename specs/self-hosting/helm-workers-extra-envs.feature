Feature: Extra environment variables on the Helm workers container

  The workers container receives app.extraEnvs and workers.extraEnvs. A
  name set in both lists renders once, with the workers value, so the
  container never carries a duplicate env name. Kubernetes accepts a
  duplicate on create but the strategic merge patch of `helm upgrade`
  refuses it, so an install that sets the same name twice could not upgrade.

  # Bindings: charts/langwatch/tests/workers-extra-envs.sh (the
  # "render + assertions" job in .github/workflows/langwatch-chart.yml).

  @unit
  Scenario: a variable set in both app and workers extraEnvs renders once on the workers container
    Given app.extraEnvs and workers.extraEnvs both set the same variable name
    When the chart renders
    Then the workers container lists that name once
    And its value is the one from workers.extraEnvs
    And the app container keeps the value from app.extraEnvs

  @unit
  Scenario: a variable set only in app extraEnvs still reaches the workers container
    Given app.extraEnvs sets a variable that workers.extraEnvs does not
    When the chart renders
    Then the workers container carries that variable with the app value
