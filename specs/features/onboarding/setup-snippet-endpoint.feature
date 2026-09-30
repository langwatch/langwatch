Feature: Setup snippets name the address readers reach the installation on
  As a self-hosted LangWatch user copying a setup snippet
  I want LANGWATCH_ENDPOINT to be the public URL I opened the app on
  So that my SDK reaches the installation instead of an in-cluster address

  # A Helm install can name an internal BASE_HOST (app.http.baseHost) and a
  # different public URL (app.http.publicUrl, served as NEXTAUTH_URL).

  @unit
  Scenario: The served page carries the public URL readers sign in on
    Given NEXTAUTH_URL is "https://langwatch.acme.example"
    When the auth module projects its browser config
    Then the config names "https://langwatch.acme.example" as the public URL

  @unit
  Scenario: The browser deployment prefers the public URL over BASE_HOST
    Given BASE_HOST is "http://localhost:5560" and the public URL is "http://localhost:5580"
    When the browser derives the deployment's address
    Then the address every setup snippet copies is "http://localhost:5580"

  @unit
  Scenario: The browser deployment falls back to BASE_HOST without a public URL
    Given BASE_HOST is "https://app.example" and no public URL is named
    When the browser derives the deployment's address
    Then the address every setup snippet copies is "https://app.example"

  @unit
  Scenario: The development server projects the public URL the same way
    Given the development server reads BASE_HOST "http://localhost:5560" and NEXTAUTH_URL "http://localhost:5580"
    When it projects the page's public config
    Then the auth slice names "http://localhost:5580" as the public URL

  @integration
  Scenario: The project home's setup snippets use the deployment's address
    Given a self-hosted installation reached on "https://langwatch.acme.example"
    When I open the project home
    Then the address its onboarding snippets copy is "https://langwatch.acme.example"

  @integration
  Scenario: The API keys page snippets use the deployment's address
    Given a self-hosted installation reached on "https://langwatch.acme.example"
    When I open the API keys page
    Then its snippets name "https://langwatch.acme.example" as the endpoint
