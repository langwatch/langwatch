Feature: Publish the static documentation through CloudFront

  @unit
  Scenario: Route directory URLs and preserve static assets
    Given the generated viewer request function
    When a reader requests a page with or without its trailing slash
    Then CloudFront requests that page's index HTML
    And static assets keep their original paths and query strings

  @unit
  Scenario: Serve every configured redirect at the edge
    Given the redirects from docs.json
    When a reader requests each source with an incoming query
    Then the edge returns a permanent redirect to the configured destination
    And destination query values and fragments take precedence

  @unit
  Scenario: Reject malformed edge paths
    Given a request path contains invalid percent encoding
    When the edge handles the request
    Then it returns a bad request response

  @unit
  Scenario: Reject a function larger than the CloudFront limit
    Given redirect data exceeds the CloudFront function size limit
    When the deployment artefact is generated
    Then generation fails before it can be published

  @unit
  Scenario: Build with materialized Git LFS assets
    Given docs images, videos and fonts are tracked with Git LFS
    When the documentation checkout downloads its LFS objects
    Then the static build copies the original asset bytes
    But a remaining LFS pointer makes the build fail before publishing
