Feature: The dev UI takes its public config from the api's shell

  In development Vite owns the browser shell but not the deployment's facts.
  The api already projects every installed owner's browser config, so the dev
  server lifts the config meta tag from the api's own rendered shell instead of
  keeping a second copy of each owner's projection.

  @unit
  Scenario: The dev server injects the api's public config
    Given the api answers /index.html with a public config meta tag
    When the dev server starts
    Then every page it serves carries that meta tag's config unchanged

  @unit
  Scenario: The api is unreachable when the dev server starts
    Given nothing answers on the api's address
    When the dev server starts and serves a page
    Then its config loads without asking the api
    And the page is served at once and boots into the branded waiting page, which reloads itself until the api answers
    And the log names the api address it tried and that the api must be running

  @unit
  Scenario: The api answers a shell without the config meta tag
    Given the api answers /index.html with no public config meta tag
    When the dev server starts
    Then it fails naming the api address and the missing meta tag

  @unit
  Scenario: A local https api with a self-signed certificate is trusted
    Given the dev stack serves the api over https with a self-signed certificate on a local host
    When the dev server fetches the api's shell
    Then the shell is read, as the dev proxy already trusts that certificate
    And an https api on any other host is still verified
