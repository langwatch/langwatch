Feature: Teaching surfaces cite only what exists
  As an agent learning the architecture from skills, rule digests, best practices and CLAUDE.md
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

    @unit
    Scenario: A best-practices page citing a path that is not in the tree fails
      Given a page under dev/docs/best_practices citing a repository path that is not in the tree
      When the check reads it
      Then the path is reported, naming the page and the line

    @unit
    Scenario: A Was column, build output and local-only files are not citations
      Given a table whose Was column names a deleted path, and a citation of build output or a local-only file
      When the check reads it
      Then nothing is reported, while the table's other columns are still checked

    @unit
    Scenario: A dead citation says what to cite instead
      Given a page citing a path that is not in the tree
      When the check reports it
      Then the finding names the dead path and says to cite what exists today or drop the citation

  Rule: `dead-path-citations` reports every dead repository path in reference pages, docs and specs

    @unit
    Scenario: A reference page, product doc or spec citing a path that is not in the tree is reported
      Given a reference page under dev/docs, a product doc under docs and a spec, each citing a dead path
      When the check reads them
      Then each dead path is reported against its page

    @unit
    Scenario: Decision records, plans and best practices are not read by the shrink check
      Given dead paths cited under dev/docs/adr, dev/docs/plans and dev/docs/best_practices
      When the shrink check reads the tree
      Then none of them is reported by it

    @unit
    Scenario: A product doc naming the customer's own files is not a citation
      Given a product doc citing the customer's own Claude settings and workflow files, and an MCP method name
      When the check reads it
      Then nothing is reported

    @unit
    Scenario: No page gains a dead path citation beyond the shrink-only list
      Given the repository and tests/baselines/dead-path-citations.json
      When the check counts dead path citations per page
      Then no page holds more than its listed count

    @unit
    Scenario: A page that drops a dead citation lowers its count in the same change
      Given the repository and tests/baselines/dead-path-citations.json
      When the check counts dead path citations per page
      Then no page holds fewer than its listed count

  Rule: `lint-rule-skill-pointers` reports a house rule that names no skill

    @unit
    Scenario: A house rule whose message names no skill is reported
      Given one rule whose message names a skill and another whose message does not
      When the check reads the rules
      Then only the rule with no skill is reported, comments not counting
