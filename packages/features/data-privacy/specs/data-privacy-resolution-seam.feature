Feature: A project's privacy policy resolves without the write graph
  Every span LangWatch folds asks which content categories the customer wanted
  dropped and which redacted, and the answer is inherited down organization,
  team, department and project. All four ids are on the project's own row. The
  data privacy service nonetheless requires an organization service, because
  writing a rule for a team scope has to decide which organization that team
  belongs to — so a process that only reads policies had to be able to build the
  write half too.

  Rule: The resolution composes from a database and one project read

    @unit
    Scenario: The policy resolution composes from a database and one project read
      Given a Prisma client and a project read with its team
      When a project's policy is resolved
      Then the inheritance chain is read inside that project's own organization

    @unit
    Scenario: A stored drop rule reaches the resolved policy
      Given a project-scoped rule that drops the input category
      When the project's policy is resolved
      Then the resolved policy drops the input category

    @unit
    Scenario: A second resolution inside the window reuses the first
      Given a project whose policy has just been resolved
      When it is resolved again inside the cache window
      Then the policy rows are read once
