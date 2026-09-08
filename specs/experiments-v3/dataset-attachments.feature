Feature: An uploaded file in a dataset cell reaches the target as its bytes
  As a user who uploads a picture or a document into a dataset cell
  I want the target of my run to receive the file itself
  So that the model reads the document instead of a link it cannot open

  Background:
    A cell of type image or file holds a reference to the deployment's object
    store, not the bytes. Only this deployment serves that reference, and only to
    an authenticated caller. The NLP engine, a connected agent and an HTTP agent
    are none of those, so a reference sent as it stands reaches the model as a
    path it cannot open.

    Before a cell is dispatched, the run replaces such a reference with the bytes
    as a base64 data URL. Which values are attachments is decided by the type of
    the dataset column the input reads from, so a reference typed into a text
    column stays the text it is. The project comes from the run and never from
    the cell, so a reference pasted from another project is never served.

    # Bindings:
    #   packages/features/experiment/server/src/services/__tests__/experiment-attachment-inlining.unit.test.ts
    #   packages/features/experiment/server/src/services/__tests__/experiment-attachment-inlining.integration.test.ts

  @unit
  Scenario: An uploaded picture in an image column reaches the target as its bytes
    Given a row whose image column holds an uploaded picture
    When the run builds the target's inputs
    Then the picture travels as its bytes, not as the stored reference

  @unit
  Scenario: An uploaded document in a file column reaches the target as its bytes
    Given a row whose file column holds an uploaded PDF
    When the run builds the target's inputs
    Then the document travels as its bytes, and its media type says it is a PDF

  @unit
  Scenario: A reference to another project's attachment is left as text
    Given a row whose image column holds a reference belonging to another project
    When the run builds the target's inputs
    Then the value is left exactly as the cell holds it
    And the object store is never asked for those bytes

  @unit
  Scenario: A plain web address in an image column is left as it is
    Given a row whose image column holds an ordinary https address
    When the run builds the target's inputs
    Then the address is left as it is, for the engine to fetch

  @unit
  Scenario: A reference in a text column is left as text
    Given a row whose text column holds something that looks like a stored reference
    When the run builds the target's inputs
    Then the value is left exactly as the cell holds it

  @unit
  Scenario: A reference whose bytes the deployment no longer holds is left as text
    Given a row whose image column references an attachment the object store cannot find
    When the run builds the target's inputs
    Then the value is left exactly as the cell holds it and the run continues

  @unit
  Scenario: A deployment with no object store leaves every reference as text
    Given a deployment that composed no object store
    When the run builds the target's inputs for a row holding an uploaded picture
    Then the value is left exactly as the cell holds it and the run continues

  @unit
  Scenario: A file dataset column becomes a file field on the run's entry node
    Given a dataset with an image column and a file column
    When the run builds the workflow for one cell
    Then the entry node declares those two fields as image and file, not as text
    # A text field would put the whole attachment into the prompt as prose.

  @unit
  Scenario: A file dataset column becomes a file variable in the studio
    Given a dataset column typed file
    When the studio derives the variable type for it
    Then the variable is typed file

  @integration
  Scenario: A prompt target receives the uploaded picture as bytes
    Given a workbench column whose prompt reads an image variable from an image column
    When I run that row
    Then the engine is dispatched with the picture's bytes in that input

  @integration
  Scenario: A connected agent receives the uploaded document as bytes
    Given a workbench column whose connected agent reads its input from a file column
    When I run that row
    Then the agent's user message carries the document's bytes
