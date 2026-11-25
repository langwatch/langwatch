Feature: langevals boots on a read-only root filesystem
  As an operator installing LangWatch with the Helm chart,
  I want the evaluator service to start cleanly with a read-only root and HOME=/,
  So that it runs under the chart's hardened security context.

  # gunicorn 25.1 and later open a control socket under $HOME/.gunicorn by
  # default. On a read-only root that write fails at every boot.

  @unit
  Scenario: The server's gunicorn settings keep the control socket off
    Given the settings the server hands gunicorn
    When gunicorn applies them
    Then the control socket is disabled
    And every setting is one gunicorn knows

  @unit
  Scenario: The server's bind address and worker count follow its arguments
    Given a host, port and worker count
    When gunicorn applies the server's settings
    Then it binds that host and port with that many workers
