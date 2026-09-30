Feature: LangWatchQL is edited in one kit editor with its grammar, completion and hover

  Any module mounts the same editor and gives it the project's schema. Its assistance comes from the
  live schema read, never from a table or column list written in the browser.

  Rule: Any module mounts the same editor

    @integration
    Scenario: The editor completes against the schema its host gives it
      Given an editor given a schema
      When the editor loads
      Then completion is offered against that schema

    @integration
    Scenario: The dashboard widget reads the schema of its own project for the editor
      Given a widget query in a project
      When its schema is read
      Then the read is for that project and a failed read gives no schema

  Rule: Grammar and completion come from the live schema

    @unit
    Scenario: Function tokens come from the schema's functions list, not a hard-coded list
      Given a schema naming a function the grammar has never seen
      When a statement calling it is tokenized
      Then the call is a function token and an unlisted name is a plain identifier

    @unit
    Scenario: Dataset names complete after FROM in the schema's order
      Given a schema with several datasets
      When the cursor sits after FROM
      Then every dataset is offered as analytics.<name> in the schema's order

    @unit
    Scenario: Columns complete for the datasets in scope with type and description
      Given a statement reading one dataset under an alias
      When the cursor follows the alias and a dot
      Then that dataset's columns are offered with their type and description

    @unit
    Scenario: A withheld column is shown disabled with its gate and is never inserted
      Given a schema listing a column that is not available
      When columns are offered
      Then the column names its gate and accepting it inserts nothing

    @unit
    Scenario: App functions complete with their signature snippet
      Given a schema with an available app function
      When functions are offered
      Then the app function inserts a snippet with a stop for each argument

    @unit
    Scenario: Hover shows the schema's own description of an identifier
      Given a schema whose column carries a type, unit and description
      When the cursor rests on that column
      Then the hover names the type and unit and reproduces the description

    @unit
    Scenario: A parameter completes as its bound token
      Given a parameter the host offers
      When the cursor follows an opening brace
      Then the parameter is offered as {name:Type}

  Rule: Tooling fails open

    @integration
    Scenario: A missing schema leaves a working editor that still completes keywords
      Given an editor given no schema because it is loading or the read failed
      When the editor is mounted and the member asks for completion
      Then the editor is editable and keywords are offered

    @integration
    Scenario: Markers the host passes are drawn at their position
      Given an editor given a marker at a line and column
      When the editor is mounted
      Then the model carries that marker with its message and position
