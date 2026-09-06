Feature: Experimentation resources are OSS (Apache 2.0) and uncapped

  LangWatch's core experimentation surfaces — prompts, evaluators/LLM-as-a-Judge,
  scenarios + agent simulations, workflows, agents, experiments, online evaluations,
  datasets, dashboards, custom graphs, and automations — are open source under
  Apache 2.0. They carry NO creation limit on any plan or license, including the
  free tier and self-hosted deployments without a license.

  Commercial value is captured elsewhere: traces/messages volume, member
  seats (members / lite members), Enterprise security (advanced SSO/SCIM,
  audit logs, data retention), support & SLAs, and managed Cloud. Those remain
  gated and are covered by their own feature files. Workspace structure —
  projects and teams — is uncapped on every plan, same as the experimentation
  resources above.

  As a LangWatch user on any plan (free, paid, or self-hosted without a license)
  I want to create unlimited prompts, evaluators, scenarios, and other
  experimentation resources
  So that I can build and iterate without hitting an artificial "up to 3" cap

  Background:
    Given an organization "org-123" exists
    And a project "proj-789" exists in the organization

  Scenario Outline: No creation cap on experimentation resources for free-tier organizations
    Given the organization is on the free plan
    And the organization already has 50 <resource>
    When I create another <resource> in project "proj-789"
    Then the <resource> is created successfully
    And no upgrade modal or limit error is shown

    Examples:
      | resource           |
      | prompts            |
      | evaluators         |
      | scenarios          |
      | workflows          |
      | agents             |
      | experiments        |
      | online evaluations |
      | datasets           |
      | dashboards         |
      | custom graphs      |
      | automations        |

  Scenario: Self-hosted deployment without a license can create unlimited experimentation resources
    Given a self-hosted deployment with no license stored
    And the organization already has 100 prompts
    When I create another prompt in project "proj-789"
    Then the prompt is created successfully

  Scenario: Agent simulations are not gated by a scenario-set cap
    Given the organization is on the free plan
    And the organization has already run simulations across 10 distinct scenario sets
    When a RUN_STARTED event arrives for an 11th, new scenario set
    Then the event is accepted and the simulation runs

  Scenario: Workspace structure (projects and teams) has no creation cap
    Given the organization is on the free plan
    And the organization already has 50 projects across 20 teams
    When I create another project or team
    Then it is created successfully
    And no upgrade modal or limit error is shown

  Scenario: Creation-limit enforcement still applies only to member seats
    Given the organization is on the free plan
    Then creation limits are still enforced for "members" and "membersLite"
    But creation limits are not enforced for projects, teams, or any experimentation resource

  @unit
  Scenario: A pre-existing signed license that still encodes experimentation limits stays valid
    Given a self-hosted license signed before the experimentation limits were removed
    And its signed payload still carries maxPrompts, maxWorkflows, maxScenarios, and similar caps
    When the upgraded platform validates that license
    Then the license is accepted with no re-issuance because the signature still verifies
    And the experimentation caps are dropped from the active plan rather than enforced
    And the license's seat limits and Enterprise tier still apply
