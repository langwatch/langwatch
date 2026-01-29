Feature: License Activation UI
  As a self-hosted user
  I want to activate a license by uploading a file or entering a key
  So that I can easily enable my LangWatch license using my preferred method

  Background:
    Given I am logged in as an administrator
    And the platform is deployed in self-hosted mode (IS_SAAS=false)
    And no license is currently installed

  # Settings menu navigation - License option visibility
  @e2e
  Scenario: License menu item visible in self-hosted mode
    When I navigate to the settings page
    Then I see "License" in the settings sidebar menu
    And when I click "License" I am navigated to /settings/license

  @integration
  Scenario: License menu item hidden in SaaS mode
    Given the platform is deployed in SaaS mode (IS_SAAS=true)
    When I navigate to the settings page
    Then I do not see "License" in the settings sidebar menu
    And I see "Subscription" in the settings sidebar menu instead

  # License activation - dual input method UI
  @e2e
  Scenario: Default activation method is file upload
    Given I am on the license settings page at /settings/license
    Then I see the "Activate a license" section
    And the "Upload license file" checkbox is checked by default
    And I see the file dropzone with text "Drop your license here"
    And the "Enter license key" checkbox is unchecked
    And the license key textarea is not visible

  @e2e
  Scenario: Switch to license key input method
    Given I am on the license settings page at /settings/license
    When I click the "Enter license key" checkbox
    Then the "Enter license key" checkbox becomes checked
    And the "Upload license file" checkbox becomes unchecked
    And the file dropzone is hidden
    And I see the license key textarea with placeholder "Paste your license key"

  @e2e
  Scenario: Switch back to file upload method
    Given I am on the license settings page at /settings/license
    And I have selected the "Enter license key" method
    When I click the "Upload license file" checkbox
    Then the "Upload license file" checkbox becomes checked
    And the "Enter license key" checkbox becomes unchecked
    And the license key textarea is hidden
    And I see the file dropzone with text "Drop your license here"

  # Checkbox behavior - mutually exclusive selection
  @integration
  Scenario: Only one activation method can be selected at a time
    Given I am on the license settings page
    When I check "Enter license key"
    Then "Upload license file" is automatically unchecked
    When I check "Upload license file"
    Then "Enter license key" is automatically unchecked

  @integration
  Scenario: Cannot uncheck both methods - at least one must be selected
    Given I am on the license settings page
    And "Upload license file" is checked
    When I try to uncheck "Upload license file" without checking another option
    Then "Upload license file" remains checked
    And a validation ensures at least one method is always selected

  # File upload flow
  @e2e
  Scenario: Upload license file via dropzone
    Given I am on the license settings page
    And the file upload method is selected
    When I drop a file named "company.langwatch-license" onto the dropzone
    Then the dropzone shows the uploaded file name "company.langwatch-license"
    And the dropzone shows the file size
    And I see a remove button to clear the uploaded file
    And the "Activate License" button becomes enabled

  @e2e
  Scenario: Upload license file via click to browse
    Given I am on the license settings page
    And the file upload method is selected
    When I click on the dropzone
    Then a file browser dialog opens
    And I can select a ".langwatch-license" file

  @integration
  Scenario: File dropzone accepts only .langwatch-license files
    Given I am on the license settings page
    And the file upload method is selected
    Then the file input accepts only files with extension ".langwatch-license"
    When I try to upload a file with a different extension
    Then the file is rejected
    And I see an error message indicating only .langwatch-license files are accepted

  @integration
  Scenario: Remove uploaded license file
    Given I have uploaded a license file
    When I click the remove button on the uploaded file
    Then the file is removed
    And the dropzone returns to its empty state with "Drop your license here"
    And the "Activate License" button becomes disabled

  # License key input flow
  @e2e
  Scenario: Enter license key in textarea
    Given I am on the license settings page
    And I have selected the "Enter license key" method
    When I paste a license key into the textarea
    Then the "Activate License" button becomes enabled

  @integration
  Scenario: License key textarea trims whitespace
    Given I am on the license settings page
    And I have selected the "Enter license key" method
    When I paste a license key with leading and trailing whitespace
    And I click "Activate License"
    Then the whitespace is trimmed before activation

  @integration
  Scenario: Activate License button disabled when textarea is empty
    Given I am on the license settings page
    And I have selected the "Enter license key" method
    And the textarea is empty
    Then the "Activate License" button is disabled

  # License activation
  @e2e
  Scenario: Successfully activate license via file upload
    Given I am on the license settings page
    And I have uploaded a valid license file
    When I click "Activate License"
    Then the license is activated
    And I see the license details card showing plan information
    And I see a success toast "License activated successfully"

  @e2e
  Scenario: Successfully activate license via key input
    Given I am on the license settings page
    And I have selected the "Enter license key" method
    And I have pasted a valid license key
    When I click "Activate License"
    Then the license is activated
    And I see the license details card showing plan information
    And I see a success toast "License activated successfully"

  @integration
  Scenario: Show loading state during license activation
    Given I am on the license settings page
    And I have provided a license (file or key)
    When I click "Activate License"
    Then the button shows a loading spinner
    And the button is disabled during activation
    And the input method selection is disabled during activation

  @integration
  Scenario: Handle invalid license file
    Given I am on the license settings page
    And I have uploaded an invalid license file
    When I click "Activate License"
    Then I see an error toast with title "Failed to activate license"
    And the error message explains the license is invalid or tampered

  @integration
  Scenario: Handle expired license file
    Given I am on the license settings page
    And I have uploaded an expired license file
    When I click "Activate License"
    Then I see an error toast with title "Failed to activate license"
    And the error message explains the license has expired

  # UI styling and layout
  @integration
  Scenario: Checkbox inputs use platform checkbox component
    Given I am on the license settings page
    Then the activation method checkboxes use the Checkbox component from "~/components/ui/checkbox"
    And the checkboxes are styled consistently with the platform design

  @integration
  Scenario: File dropzone matches platform dropzone styling
    Given I am on the license settings page
    Then the file dropzone uses dashed border styling
    And the dropzone has borderRadius "lg"
    And the dropzone border color changes on hover/drag

  @integration
  Scenario: License key textarea uses platform textarea styling
    Given I am on the license settings page
    And I have selected the "Enter license key" method
    Then the textarea uses Field.Root and Field.Label components
    And the textarea has fontFamily "mono" for license key display
    And the textarea has appropriate row count for the license key format

  # Unit tests for activation method logic
  @unit
  Scenario: Activation method state defaults to file upload
    Given the license activation component initializes
    Then the activationMethod state is "file"
    And showFileUpload is true
    And showKeyInput is false

  @unit
  Scenario: Switching activation method updates visibility flags
    Given the activation method is "file"
    When setActivationMethod is called with "key"
    Then showFileUpload becomes false
    And showKeyInput becomes true

  @unit
  Scenario: License file content is read and passed to activation API
    Given a license file is uploaded
    When the file is read
    Then the file content is extracted as text
    And the content is passed to the license activation mutation

  @unit
  Scenario: License key normalization handles different input formats
    Given a license key input
    When normalizeKeyForActivation is called
    Then leading/trailing whitespace is trimmed
    And the normalized key is returned for API submission
