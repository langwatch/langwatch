Feature: Python SDK get_dataset reads a dataset page by page
  As a Python SDK user with datasets of large rows, such as rows that hold images
  I want get_dataset() to return the whole dataset whatever its size
  So that a dataset is never refused for being larger than one response can hold

  # get_dataset() reads the entries from the records endpoint page by page. Each
  # page also carries the dataset's metadata. A server that does not send it is
  # asked through the datasets list, then through the single request. The
  # returned object is the same as the one the single request gives.


  @unit
  Scenario: Get dataset reads a dataset larger than the single response limit page by page
    Given a dataset whose rows add up to more than one response can hold
    When I call langwatch.dataset.get_dataset("product-images")
    Then a Dataset object is returned with every row in its original order
    And the metadata comes from the records page
    And the dataset was never asked for in a single response

  @unit
  Scenario: Get dataset keeps the shape of the single response
    Given a dataset "product-images" exists with 3 records
    When the SDK reads it page by page
    Then the result holds the dataset's id, name, slug, column types, timestamps and platform URL
    And every record is under "data" with the fields the single response gives it

  @unit
  Scenario: Get dataset result still converts to a pandas DataFrame
    Given a dataset "product-images" exists with 300 records
    When I call langwatch.dataset.get_dataset("product-images").to_pandas()
    Then the DataFrame has 300 rows in the dataset's order

  @unit
  Scenario: Get dataset follows the page size a refusal suggests
    Given the server refuses a page of rows as too large and suggests a smaller page size
    When I call langwatch.dataset.get_dataset("product-images")
    Then the SDK asks again for the same rows with the suggested page size
    And a Dataset object is returned with every row in its original order

  @unit
  Scenario: Get dataset asks for fewer rows when the server refuses a page as too large
    Given the server refuses a page of rows as too large without suggesting a page size
    When I call langwatch.dataset.get_dataset("product-images")
    Then the SDK asks again for the same rows with half the page size until a page is accepted
    And a Dataset object is returned with every row in its original order

  @unit
  Scenario: Get dataset finds the metadata in the datasets list on a server that sends none with its pages
    Given a server whose records pages do not carry the dataset
    When I call langwatch.dataset.get_dataset("product-images")
    Then the dataset's id, name and slug come from the datasets list
    And the dataset was never asked for in a single response

  @unit
  Scenario: Get dataset raises the server's refusal when only the single request can name the dataset
    Given a server whose records pages and datasets list do not name the dataset
    And the dataset is too large for the single response
    When I call langwatch.dataset.get_dataset("product-images")
    Then a DatasetApiError with status 400 is raised with the server's message
    And no partial dataset is returned

  @unit
  Scenario: Get dataset reads one oversized row alone and returns to larger pages
    Given a dataset whose first row is as large as a whole page may be
    When I call langwatch.dataset.get_dataset("product-images")
    Then the first row is read in a page of its own
    And the following small rows are read in large pages again

  @unit
  Scenario: Get dataset raises the refusal when a single row is too large to read
    Given a server that refuses even a page that holds only one row
    When I call langwatch.dataset.get_dataset("product-images")
    Then a DatasetApiError with status 413 is raised

  @unit
  Scenario: Get dataset falls back to the single request on a server without the records endpoint
    Given a self-hosted server that has no records endpoint
    When I call langwatch.dataset.get_dataset("product-images")
    Then the dataset is read with the single request
    And a Dataset object is returned with every row

  @unit
  Scenario: Get dataset raises not found when neither request finds the dataset
    When I call langwatch.dataset.get_dataset("does-not-exist")
    Then a DatasetNotFoundError is raised

  @unit
  Scenario: Get dataset stops when rows are removed while it is reading
    Given rows are removed from the dataset after the first page was read
    When I call langwatch.dataset.get_dataset("product-images")
    Then the read ends at the first page that comes back short
