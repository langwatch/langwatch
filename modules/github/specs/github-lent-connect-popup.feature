Feature: GitHub lends its install popup by its client token
  Langy connects the GitHub App through the popup github lends by the token in
  @langwatch/github-client, never by importing github's browser package (ARCHITECTURE.md §10.1).

  @unit
  Scenario: github lends its install popup by its client token
    Given a browser that installs github
    When a reader looks up the connect popup token from github's client
    Then github lends the popup hooks as an eager value
