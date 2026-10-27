Feature: Teaching surfaces cite only what exists
  As an agent learning the architecture from skills, rule digests and CLAUDE.md
  I want every rule, policy, record section, skill and path they cite to exist
  So that a renamed or deleted thing cannot keep being taught

  Rule: `teaching-citations` refuses a citation of something that is not in the tree

    @unit
    Scenario: A citation of something that exists passes
      Given a page citing a rule, a policy, a section, a skill and a path that exist
      When the check reads it
      Then nothing is reported

    @unit
    Scenario: A cited lint rule that does not exist fails
      Given a page citing a lint rule that is not declared
      When the check reads it
      Then the rule is reported

    @unit
    Scenario: A Backed-by column is read by kind
      Given a Backed-by column naming a rule, a policy and a skill
      When the check reads it
      Then bare names are checked against rules and skills, and policies against the registry

    @unit
    Scenario: A cited record section that does not exist fails
      Given a page citing a record section with no heading
      When the check reads it
      Then the section is reported, and another document's section is left alone

    @unit
    Scenario: A cited skill that does not exist fails
      Given a page citing a skill with no folder
      When the check reads it
      Then the skill is reported, and a skill the harness ships passes

    @unit
    Scenario: A cited repository path that does not exist fails
      Given a page citing a repository path that is not in the tree
      When the check reads it
      Then the path is reported

    @unit
    Scenario: Placeholder and glob segments match any name
      Given a path citing placeholder and glob segments
      When the check reads it
      Then it passes when some folder matches and fails when none does

    @unit
    Scenario: Retired mentions, code samples and module-relative paths are not citations
      Given a citation in a fence, a retired sentence or a module-relative path
      When the check reads it
      Then nothing is reported

    @unit
    Scenario: A missing anchor refuses the run
      Given the record is missing
      When the check runs
      Then it throws, naming the policy

  Rule: `lint-rule-skill-pointers` reports a house rule that names no skill

    @unit
    Scenario: A house rule whose message names no skill is reported
      Given one rule whose message names a skill and another whose message does not
      When the check reads the rules
      Then only the rule with no skill is reported, comments not counting
