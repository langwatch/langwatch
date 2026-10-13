Feature: A Langy turn's GitHub token
  A turn that reads or pushes to the organization's repositories needs the GitHub App
  installation token, read through GithubApi.

  @unit
  Scenario: A turn gets a GitHub token where a GitHub App is configured
    Given the deployment configured a GitHub App installed on the organization
    When a turn starts
    Then it carries the installation token GitHub minted for the organization

  @unit
  Scenario: A turn gets no GitHub token without a GitHub App
    Given the deployment configured no GitHub App
    When a turn starts
    Then it carries no GitHub token
