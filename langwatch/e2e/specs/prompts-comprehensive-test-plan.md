# Prompts Page - Comprehensive Test Plan

## Application Overview

The Prompts page in LangWatch provides a prompt playground for designing, testing, and optimizing AI prompts. The application features:

-   **Prompt Management**: Create, edit, save, and organize prompts with unique identifiers
-   **System & User Messages**: Configure multi-turn conversations with system, user, and assistant messages
-   **Model Configuration**: Select LLM models and configure parameters (temperature, max tokens)
-   **Real-time Testing**: Interactive chat interface to test prompts with model responses
-   **Version Control**: Track prompt versions and restore previous iterations
-   **Split View**: Open prompts in multiple tabs for side-by-side comparison
-   **API Integration**: Generate code snippets in multiple languages (Python, Node, Shell, PHP, Go, Java)
-   **Tab Synchronization**: Sync conversations across split tabs

## Test Scenarios

### 1. Creating a New Prompt

**Seed:** `e2e/seed.spec.ts`

#### 1.1 Create First Prompt from Empty State

**Steps:**

1. Navigate to `/prompts` page with no existing prompts
2. Verify "No prompts yet" message is displayed
3. Click "Create First Prompt" button
4. Verify prompt playground opens with default configuration

**Expected Results:**

-   Empty prompt titled "Untitled" is created
-   Default system prompt shows "You are a helpful assistant."
-   Default model is "gpt-5"
-   Single tab is created in the workspace
-   Save button is initially disabled
-   Draft indicator shows in the header
-   Conversation and Settings tabs are visible
-   Chat interface is ready for interaction

### 2. Saving a Prompt

#### 2.1 Save New Prompt with Identifier

**Steps:**

1. Create a new prompt (from scenario 1.1)
2. Click "Save" button
3. In the "Save Prompt" dialog, enter identifier: "test-assistant"
4. Verify Project scope is selected
5. Click "Save" in the dialog

**Expected Results:**

-   Save Prompt dialog appears with:
    -   "Prompt Identifier" field with placeholder
    -   Example text showing identifier format
    -   Project/Organization scope selector
    -   Save button (disabled until identifier is entered)
-   After entering identifier, Save button becomes enabled
-   After saving:
    -   Prompt appears in left sidebar with identifier name
    -   Tab title updates from "Untitled" to identifier
    -   Version indicator shows "v1"
    -   Save button changes to "Saved" and becomes disabled
    -   API button becomes enabled

#### 2.2 Validation - Empty Identifier

**Steps:**

1. Click Save with empty identifier field
2. Attempt to click Save button

**Expected Results:**

-   Save button remains disabled
-   Cannot proceed without identifier

#### 2.3 Validation - Identifier Format

**Steps:**

1. Enter identifier with special characters or invalid format
2. Observe validation

**Expected Results:**

-   Appropriate validation message if format is invalid
-   Example text guides proper format (e.g., "prompt-name" or "marketing/tone-of-voice")

### 3. Editing Prompt Content

#### 3.1 Modify System Prompt

**Steps:**

1. Open existing prompt
2. Click in the system prompt textbox
3. Clear existing text
4. Type new system message: "You are an expert software developer"
5. Observe Save button state

**Expected Results:**

-   System prompt textbox is editable
-   Text updates in real-time
-   Save button becomes enabled (changes from "Saved" to "Save")
-   Draft state is indicated

#### 3.2 Add User Message

**Steps:**

1. Open existing prompt
2. Click the "+" button next to "System prompt"
3. Select "User" from the dropdown
4. Type in user message textbox: "What programming languages do you know?"
5. Observe changes

**Expected Results:**

-   Dropdown menu appears with "User" and "Assistant" options
-   New user message section is added below system prompt
-   User message label shows "user"
-   Delete button appears next to user label
-   Textbox is empty and ready for input
-   Save button becomes enabled

#### 3.3 Add Assistant Message

**Steps:**

1. From scenario 3.2, click "+" button again
2. Select "Assistant" from dropdown
3. Type assistant message: "I can help you with a variety of tasks!"
4. Observe the message structure

**Expected Results:**

-   Assistant message section is added
-   Assistant message label shows "assistant"
-   Delete button appears next to assistant label
-   Messages are ordered: System → User → Assistant
-   Save button remains enabled

#### 3.4 Delete Message

**Steps:**

1. Click delete button next to a user or assistant message
2. Observe message removal

**Expected Results:**

-   Message is immediately removed
-   Remaining messages reflow
-   Save button becomes enabled if saved version existed

### 4. Model Configuration

#### 4.1 Open Model Configuration Dialog

**Steps:**

1. Click on the model dropdown showing "gpt-5"
2. Observe the LLM Config dialog

**Expected Results:**

-   "LLM Config" dialog opens
-   Shows three configuration sections:
    -   Model selector (dropdown with current model)
    -   Temperature (with description)
    -   Max Tokens (with description)
-   Link to model providers settings is visible
-   Close button is present

#### 4.2 Change Model

**Steps:**

1. In LLM Config dialog, click Model dropdown
2. Select a different model from the list
3. Click close or outside dialog

**Expected Results:**

-   Available models are listed in dropdown
-   Selected model updates in the configuration
-   Model indicator in header updates
-   Temperature field behavior changes based on model:
    -   For GPT-5: Temperature is fixed to 1 (disabled field with explanation)
    -   For other models: Temperature slider is enabled

#### 4.3 Set Max Tokens

**Steps:**

1. In LLM Config dialog, click Max Tokens field
2. Enter value: 2000
3. Close dialog

**Expected Results:**

-   Max Tokens spinbutton accepts numeric input
-   Value is saved to configuration
-   Save button becomes enabled
-   Configuration persists after closing dialog

#### 4.4 Temperature Constraints

**Steps:**

1. Select GPT-5 model
2. Observe Temperature field

**Expected Results:**

-   Temperature shows value "1"
-   Field is disabled
-   Helper text explains: "Temperature is fixed to 1 for GPT-5 models"

### 5. Testing Prompts with Chat

#### 5.1 Send First Message

**Steps:**

1. Configure prompt with system message
2. Navigate to Conversation tab
3. Type in chat input: "Hello, what can you help me with?"
4. Click send button or press Enter
5. Wait for response

**Expected Results:**

-   Message appears in chat with user's text
-   Send button becomes disabled during processing
-   Loading indicator or status appears
-   Model response appears below user message
-   "View Trace" button appears next to message
-   Chat input is cleared and ready for next message
-   Input field is re-enabled after response

#### 5.2 Multi-turn Conversation

**Steps:**

1. From scenario 5.1, send follow-up message
2. Observe conversation history
3. Send third message

**Expected Results:**

-   All messages maintain chronological order
-   Context is maintained across turns
-   Each message has a "View Trace" button
-   Scrolling works properly as conversation grows

#### 5.3 Reset Chat

**Steps:**

1. After having a conversation, click "Reset chat" button
2. Observe conversation state

**Expected Results:**

-   Conversation history is cleared
-   Chat input is empty and enabled
-   System prompt configuration is preserved
-   Warning or confirmation may appear before clearing

### 6. Sync Across Tabs

#### 6.1 Split Prompt into Two Windows

**Steps:**

1. Open existing prompt
2. Click "Split tab" button (icon with two panels)
3. Observe layout

**Expected Results:**

-   Workspace splits into two panels side-by-side
-   Same prompt appears in both panels
-   Both show same version
-   Each panel has its own tab controls
-   Both panels show same conversation if synced

#### 6.2 Verify Sync Checkbox Behavior

**Steps:**

1. In split view, type message in left panel chat
2. Send message
3. Observe right panel

**Expected Results:**

-   "Sync across tabs" checkbox is visible (on hover over chat area)
-   When checked (default), conversations sync across both panels
-   Same message appears in both panels
-   Response appears in both panels simultaneously

#### 6.3 Disable Sync and Test Independence

**Steps:**

1. In split view, hover over chat area
2. Uncheck "Sync across tabs" checkbox
3. Type and send message in left panel only
4. Observe right panel

**Expected Results:**

-   Checkbox becomes visible on hover
-   After unchecking, conversations become independent
-   Message sent in left panel only appears there
-   Right panel conversation remains unchanged
-   Each panel maintains separate conversation history

#### 6.4 Re-enable Sync

**Steps:**

1. From scenario 6.3, check "Sync across tabs" again
2. Send new message
3. Observe both panels

**Expected Results:**

-   New messages sync across tabs
-   Previous independent messages remain separate
-   Going forward, sync works as expected

### 7. Closing and Reopening Tabs

#### 7.1 Close Single Tab

**Steps:**

1. Open a prompt in single tab view
2. Click X button on tab
3. Observe state

**Expected Results:**

-   Tab closes
-   If last tab, shows empty state or prompt list
-   Unsaved changes warning appears if applicable

#### 7.2 Close Tab in Split View

**Steps:**

1. Open prompt in split view (scenario 6.1)
2. Click X on one of the tabs
3. Observe remaining view

**Expected Results:**

-   Closed tab's panel is removed
-   Remaining panel expands to full width
-   Split view exits, returns to single tab view
-   Conversation history is preserved in remaining panel

#### 7.3 Close Both Tabs in Split View

**Steps:**

1. Open prompt in split view
2. Close first tab (left panel disappears)
3. Close second tab
4. Observe state

**Expected Results:**

-   First close: one panel closes, other remains full width
-   Second close: returns to prompt list or empty state
-   Unsaved changes warning if applicable

#### 7.4 Reopen Prompt from Sidebar

**Steps:**

1. After closing all tabs, click on prompt in left sidebar
2. Observe opened prompt

**Expected Results:**

-   Prompt opens in new tab
-   Latest saved version is loaded
-   All configuration (model, messages) is restored
-   Previous unsaved changes are lost
-   Chat history is cleared (starts fresh)

### 8. API Code Snippet

#### 8.1 Open API Dialog

**Steps:**

1. Open saved prompt (API button must be enabled)
2. Click "API" button
3. Observe API dialog

**Expected Results:**

-   "Get Prompt by ID" dialog opens
-   Shows code snippet in default language (Python)
-   Link to API documentation is visible
-   "Copy code" button is present
-   "Select language" dropdown shows current language
-   Code includes:
    -   Import statements
    -   API key configuration
    -   Prompt fetch by identifier
    -   Property access examples
    -   Compile method with variables example

#### 8.2 Switch Language to Node.js

**Steps:**

1. In API dialog, click "Select language" button
2. Select "Node" from dropdown
3. Observe code change

**Expected Results:**

-   Language dropdown shows options:
    -   Python (with checkmark if selected)
    -   Shell
    -   Node
    -   Php
    -   Go
    -   Java
-   After selecting Node, code updates to JavaScript syntax
-   Import changes to ES6 import
-   API usage follows Node.js patterns
-   Button label updates to show "Node"

#### 8.3 Test Other Languages

**Steps:**

1. Select each language from dropdown
2. Observe code syntax changes

**Expected Results:**

-   Shell: Shows curl commands
-   PHP: Shows PHP syntax
-   Go: Shows Go syntax
-   Java: Shows Java syntax
-   Each maintains same logical structure
-   Language-specific idioms are used appropriately

#### 8.4 Copy Code

**Steps:**

1. Click "Copy code" button
2. Paste into external editor

**Expected Results:**

-   Code is copied to clipboard
-   Success feedback is shown (button change, toast, etc.)
-   Pasted code is complete and properly formatted
-   Includes all necessary imports and configuration

### 9. Version History and Handle Changes

#### 9.1 Save Prompt to Create New Version

**Steps:**

1. Open existing saved prompt (v1)
2. Make changes (edit system prompt or add message)
3. Click "Save" button
4. Observe version update

**Expected Results:**

-   After saving changes, version increments (v1 → v2)
-   Version indicator updates in tab title
-   "Saved" state is restored
-   New version is now the current working version

#### 9.2 Access Version History

**Steps:**

1. With prompt having multiple versions, click version history button (clock icon)
2. Observe version list

**Expected Results:**

-   Version history dialog or panel opens
-   Lists all versions in reverse chronological order
-   Shows version number, timestamp, and changes summary
-   Current version is highlighted or marked
-   Each version has action buttons (view, restore, etc.)

#### 9.3 View Previous Version

**Steps:**

1. In version history, click on previous version (e.g., v1)
2. Observe prompt state

**Expected Results:**

-   Prompt content updates to show that version
-   System prompt, user/assistant messages reflect old state
-   Model configuration shows settings from that version
-   Version indicator shows viewed version
-   Interface indicates this is a historical view
-   Edit capabilities may be disabled or show "viewing v1" state

#### 9.4 Restore Previous Version

**Steps:**

1. While viewing previous version, click "Restore" button
2. Confirm restoration if prompted
3. Observe changes

**Expected Results:**

-   Confirmation dialog explains restoration will create new version
-   After confirming:
    -   New version is created (e.g., v3) with content from v1
    -   Current working version becomes the restored content
    -   Version history maintains v2 in the timeline
    -   Save button changes to "Saved"
    -   Tab shows new version number

#### 9.5 Change Prompt Handle/Identifier

**Steps:**

1. Click settings or rename button for prompt
2. In "Change Prompt Handle" dialog, modify identifier
3. Enter new identifier: "test-assistant-v2"
4. Observe warning message
5. Confirm change

**Expected Results:**

-   "Change Prompt Handle" dialog opens
-   Current identifier is pre-filled
-   Warning message appears: "⚠ Warning: Changing the prompt identifier or scope may break any existing integrations, API calls, or workflows that use '[old-name]'. Make sure to update all references in your codebase and documentation."
-   Scope selector shows Project/Organization options
-   After saving:
    -   Identifier updates throughout interface
    -   Sidebar shows new name
    -   Tab title shows new name
    -   API code snippets update to use new identifier
    -   Version number is preserved

### 10. Settings Tab

#### 10.1 Navigate to Settings Tab

**Steps:**

1. Open prompt
2. Click "Settings" tab next to Conversation tab
3. Observe settings panel

**Expected Results:**

-   Settings tab becomes active
-   Settings panel displays configuration options:
    -   Inputs section (expandable)
    -   Outputs section with field configuration
    -   Demonstrations section
-   Each section has expand/collapse controls

#### 10.2 Configure Outputs

**Steps:**

1. In Settings tab, observe Outputs section
2. View default output field: "output" (type: str)
3. Click type dropdown
4. Observe available types

**Expected Results:**

-   Default output field named "output" with type "str"
-   Type dropdown shows options:
    -   str (selected)
    -   float
    -   bool
    -   json_schema
-   Delete button appears next to output field
-   Add button is visible to add more outputs

#### 10.3 Add New Output Field

**Steps:**

1. Click add button in Outputs section
2. Enter field name: "confidence"
3. Select type: "float"
4. Observe new field

**Expected Results:**

-   New output field is added to list
-   Field is editable
-   Type selector works independently
-   Multiple outputs can be configured
-   Each output has delete button

#### 10.4 Manage Demonstrations

**Steps:**

1. Click "Edit" button in Demonstrations section
2. Observe demonstrations interface

**Expected Results:**

-   Demonstrations editor opens or expands
-   Can add example input/output pairs
-   Used for few-shot learning examples
-   If error, shows: "Error rendering the dataset, please refresh the page"

### 11. Edge Cases and Error Handling

#### 11.1 Network Error During Save

**Steps:**

1. Disconnect network
2. Make changes to prompt
3. Attempt to save

**Expected Results:**

-   Error message appears explaining network issue
-   Changes are retained locally
-   Retry option is available
-   Save button remains enabled for retry

#### 11.2 Network Error During Chat

**Steps:**

1. Start conversation
2. Simulate network interruption during model response

**Expected Results:**

-   Error message appears in chat
-   Partial response (if any) is shown
-   Retry button appears
-   Conversation history is maintained
-   Can continue chatting after reconnection

#### 11.3 Unsaved Changes Warning

**Steps:**

1. Make changes to prompt
2. Attempt to close tab or navigate away

**Expected Results:**

-   Warning dialog appears
-   Message: "You have unsaved changes. Do you want to save before leaving?"
-   Options: Save, Don't Save, Cancel
-   Choosing "Save" triggers save flow
-   Choosing "Don't Save" discards changes
-   Choosing "Cancel" returns to prompt editor

#### 11.4 Long Running Model Response

**Steps:**

1. Send message that triggers slow model response
2. Wait for response (may take 10-30+ seconds)

**Expected Results:**

-   Loading indicator remains active
-   Input remains disabled
-   Can't send new messages until response completes
-   No timeout errors for reasonable delays
-   Response eventually appears
-   "View Trace" button is available

#### 11.5 Very Long Prompt or Messages

**Steps:**

1. Enter system prompt with 10,000+ characters
2. Add multiple user/assistant messages
3. Test scrolling and performance

**Expected Results:**

-   Large text is accepted
-   Textboxes expand or scroll appropriately
-   Performance remains acceptable
-   Save operation succeeds
-   Chat interface handles long messages gracefully

## Priority Test Paths

### Critical Path (P0)

1. Create new prompt → Edit content → Save with identifier → Test in chat → Verify response
2. Open saved prompt → Modify → Save → Verify version increment
3. Split view → Verify sync → Unsync → Test independence

### High Priority (P1)

1. All model configuration options (temperature, max tokens, model selection)
2. API code snippet generation in all languages
3. Add/remove system, user, and assistant messages
4. Version history viewing and restoration
5. Close/reopen tabs with state preservation

### Medium Priority (P2)

1. Handle/identifier changes
2. Settings tab configuration (inputs, outputs, demonstrations)
3. Error handling scenarios
4. Long messages and edge cases
5. Scope selection (Project vs Organization)

---

**Confidence**: 9/10

**Reasoning/Concerns**:

-   Explored most major features thoroughly through browser interaction
-   Some features like version restore and demonstrations may have additional edge cases not fully tested
-   Network error scenarios need actual implementation to verify behavior
-   Performance testing with very large prompts needs actual stress testing

**Follow-up Suggestions**:

-   Implement automated E2E tests using Playwright based on these scenarios
-   Add visual regression testing for UI consistency
-   Test with actual model integrations to verify chat functionality end-to-end
-   Verify API code snippets actually work by running them in each language environment
-   Test with multiple users simultaneously to check for race conditions
-   Add tests for keyboard shortcuts and accessibility features
-   Verify data persistence across browser sessions/refreshes

