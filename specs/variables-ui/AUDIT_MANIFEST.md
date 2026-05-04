# specs/variables-ui — unimplemented audit manifest

Total unimplemented-tagged scenarios: 78
Classified: 78

| File | Scenario | Class | Rationale |
|------|----------|-------|-----------|
| specs/variables-ui/variable-insertion-menu.feature | "Typing {{ opens the insertion menu" | KEEP | `useVariableMenu.openMenu` triggered by `findUnclosedBraces` in `PromptTextAreaWithVariables.handleChange`; no @scenario binding yet. |
| specs/variables-ui/variable-insertion-menu.feature | "Typing { alone does not open menu" | KEEP | `findUnclosedBraces` requires double `{{`; behavior implemented but unbound. |
| specs/variables-ui/variable-insertion-menu.feature | "Typing {{ at start of textarea" | KEEP | Trigger detection works at any position; no test binds it. |
| specs/variables-ui/variable-insertion-menu.feature | "Menu shows search input" | UPDATE | Search input only renders in `buttonMenuMode` (Add variable button), not when `{{` triggers — current spec implies it always shows. |
| specs/variables-ui/variable-insertion-menu.feature | "Menu shows sources grouped by name" | KEEP | `VariableInsertMenu` renders `filteredSources` as group headers; covered by existing test but not @scenario-bound. |
| specs/variables-ui/variable-insertion-menu.feature | "Fields show type icons" | KEEP | `VariableTypeIcon` is rendered per field in `VariableInsertMenu`; not bound to scenario yet. |
| specs/variables-ui/variable-insertion-menu.feature | "Fields show type badges" | UPDATE | Badges show "Text"/"Number"/"Object" not "STRING"/"OBJECT"; existing test asserts "Text instead of STRING". |
| specs/variables-ui/variable-insertion-menu.feature | "Search filters fields" | KEEP | `query`-based filter implemented in `VariableInsertMenu`; no @scenario binding. |
| specs/variables-ui/variable-insertion-menu.feature | "Search is case-insensitive" | KEEP | Filter normalises via `toLowerCase`; covered by code, not by scenario. |
| specs/variables-ui/variable-insertion-menu.feature | "Empty search shows all fields" | KEEP | Empty `query` returns all sources; behavior exists but unbound. |
| specs/variables-ui/variable-insertion-menu.feature | "No results message" | KEEP | "No matching fields found" rendered when `flattenedOptions.length === 0`. |
| specs/variables-ui/variable-insertion-menu.feature | "Click to select a field" | KEEP | `handleSelect` → `onSelect` then `closeMenu`; insertion replaces unclosed `{{` per `useVariableMenu.insertVariable`. |
| specs/variables-ui/variable-insertion-menu.feature | "Keyboard navigation and Enter to select" | KEEP | `handleKeyDown` in `PromptTextAreaWithVariables` dispatches Arrow/Enter; not bound. |
| specs/variables-ui/variable-insertion-menu.feature | "Escape closes menu without inserting" | KEEP | Escape branch calls `activeMenu.closeMenu()` without inserting. |
| specs/variables-ui/variable-insertion-menu.feature | "Selecting field creates new variable" | KEEP | `useVariableMenu.insertVariable` calls `onCreateVariable({ identifier, type })` when not in existing IDs. |
| specs/variables-ui/variable-insertion-menu.feature | "Selecting field sets mapping automatically" | KEEP | After create, `onSetVariableMapping(fieldName, sourceId, fieldName)` fires. |
| specs/variables-ui/variable-insertion-menu.feature | "Selecting does not duplicate existing variable" | KEEP | Guard `!existingVariableIds.has(fieldName)` in `useVariableMenu.insertVariable` prevents duplicates. |
| specs/variables-ui/variable-insertion-menu.feature | "Type is derived from source field" | UPDATE | Type is preserved as-is (no "number"→"float" coercion); spec implies a translation that doesn't happen. |
| specs/variables-ui/variable-insertion-menu.feature | "Add context button appears on hover" | UPDATE | Button is labelled "Add variable" (see `AddVariableButton.tsx`), not "Add context". |
| specs/variables-ui/variable-insertion-menu.feature | "Add context button opens menu" | UPDATE | Same — button label is "Add variable"; opens menu via `useVariableMenu.openButtonMenu`. |
| specs/variables-ui/variable-insertion-menu.feature | "Add context inserts at end of textarea" | UPDATE | Insertion uses cursor position not "end of textarea"; also wrong button name. |
| specs/variables-ui/variable-insertion-menu.feature | "Add context button not shown when typing" | UPDATE | Button hides on focus loss/hover-out, not specifically on typing; also wrong button name. |
| specs/variables-ui/variable-insertion-menu.feature | "Option to create new variable" | KEEP | `canCreateVariable` flag adds `Create variable "{{name}}"` option when no exact match. |
| specs/variables-ui/variable-insertion-menu.feature | "Create custom variable from menu" | KEEP | `handleCreateVariable` inserts `{{name}}` and calls `onCreateVariable({type:"str"})` with no mapping. |
| specs/variables-ui/variable-insertion-menu.feature | "Multiple {{ insertions in same text" | KEEP | `findUnclosedBraces` scans backwards from cursor; each unclosed pair triggers menu independently. |
| specs/variables-ui/variable-insertion-menu.feature | "Menu closes when clicking outside" | KEEP | Popover-based `VariableInsertMenu` auto-closes on outside click via Chakra Popover. |
| specs/variables-ui/variable-insertion-menu.feature | "Closing brace completes variable" | KEEP | Manual `}}` closes the brace pair; invalid variables show via `invalidVariables` warning text. |
| specs/variables-ui/prompt-textarea.feature | "Variables render as styled chips" | UPDATE | Implementation uses rich-textarea overlay coloring (blue text spans), not chips; spec phrasing as "chip" is wrong but blue rendering exists. |
| specs/variables-ui/prompt-textarea.feature | "Invalid variables render with warning style" | UPDATE | Invalid variables render in red text and trigger an "Undefined variables:" warning panel, not a "warning style chip". |
| specs/variables-ui/prompt-textarea.feature | "Chips are inline with text" | DELETE | No chip element exists — implementation is a transparent overlay that colors substrings; "inline" assertion is meaningless against a textarea. |
| specs/variables-ui/prompt-textarea.feature | "Typing before a chip" | DELETE | No chip semantics — typing in a textarea behaves like a normal textarea; nothing variable-specific to test. |
| specs/variables-ui/prompt-textarea.feature | "Typing after a chip" | DELETE | Same — normal textarea typing with no chip behavior. |
| specs/variables-ui/prompt-textarea.feature | "Backspace deletes chip as unit" | DELETE | Backspace deletes one character; `{{input}}` is not a unit in the underlying RichTextarea. Aspirational. |
| specs/variables-ui/prompt-textarea.feature | "Delete key removes chip as unit" | DELETE | Same — Delete is single-char in RichTextarea; no chip-as-unit behavior. |
| specs/variables-ui/prompt-textarea.feature | "Cannot edit inside a chip" | DELETE | Cursor can be placed anywhere in the textarea; no editing restriction inside `{{...}}`. |
| specs/variables-ui/prompt-textarea.feature | "Click on chip selects entire chip" | DELETE | RichTextarea uses native textarea click semantics — single click positions caret, doesn't select tokens. |
| specs/variables-ui/prompt-textarea.feature | "Drag selection includes whole chips" | DELETE | Native drag selection is character-based; no token expansion. |
| specs/variables-ui/prompt-textarea.feature | "Copy chip includes mustache syntax" | DELETE | Trivially true (text-based) but tied to chip-selection mechanics that don't exist; not a useful test. |
| specs/variables-ui/prompt-textarea.feature | "Cut chip removes it" | DELETE | Same — depends on chip-selection mechanics that don't exist. |
| specs/variables-ui/prompt-textarea.feature | "Paste variable text creates chip" | UPDATE | Paste just inserts text; coloring re-runs on render so the result is visually correct, but no separate "chip" object is created. Phrasing must be rewritten. |
| specs/variables-ui/prompt-textarea.feature | "Arrow keys skip over chips" | DELETE | Arrow keys are single-char in RichTextarea; no token-skip behavior implemented. |
| specs/variables-ui/prompt-textarea.feature | "Arrow left skips over chips" | DELETE | Same as above. |
| specs/variables-ui/prompt-textarea.feature | "Textarea expands with content" | KEEP | `useTextareaResize` and `autoHeight` resize the textarea; no scenario binding. |
| specs/variables-ui/prompt-textarea.feature | "Long chip names display properly" | UPDATE | No chip element overflow issue; long names are just long colored text — phrasing wrong. |
| specs/variables-ui/prompt-textarea.feature | "Show placeholder when empty" | KEEP | RichTextarea forwards `placeholder` prop; existing test asserts placeholder rendering. |
| specs/variables-ui/prompt-textarea.feature | "Placeholder disappears when typing" | KEEP | Native textarea placeholder behavior — works for free, just not @scenario bound. |
| specs/variables-ui/prompt-textarea.feature | "Inserted variable becomes chip" | UPDATE | Insertion works; result is colored text not a separate chip. Replace "chip" wording. |
| specs/variables-ui/prompt-textarea.feature | "Multiple insertions create multiple chips" | UPDATE | Same — wording about chips is wrong; coloring renders for each `{{var}}`. |
| specs/variables-ui/prompt-textarea.feature | "Undo chip insertion" | KEEP | `setTextareaValueUndoable` makes Ctrl+Z work via native undo stack; behavior present, unbound. |
| specs/variables-ui/prompt-textarea.feature | "Redo chip insertion" | KEEP | Native redo on the textarea undo stack; works without extra code. |
| specs/variables-ui/prompt-textarea.feature | "Focus shows cursor" | KEEP | Native textarea focus + caret; trivially true and not bound. |
| specs/variables-ui/prompt-textarea.feature | "Blur triggers onChange" | UPDATE | `onChange` is debounced (200ms) on every keystroke, not specifically on blur; spec implies blur is the trigger. |
| specs/variables-ui/variables-section.feature | "Display section with \"Variables\" label" | UPDATE | Header text is configurable via `title` prop (defaults to "Variables"); the "+" button text is actually "Add" with a Plus icon, not "+". |
| specs/variables-ui/variables-section.feature | "Display existing variables with type icons" | KEEP | `VariableTypeIcon` renders per row based on `variable.type`; covered by existing test but unbound. |
| specs/variables-ui/variables-section.feature | "Add new variable" | UPDATE | Add flow opens a type-picker menu first; spec assumes a single-click "+" that auto-creates `input:str`. Existing test clicks Add then "Text" menu item. |
| specs/variables-ui/variables-section.feature | "Add variable with unique name" | KEEP | `handleAddVariable` generates `input_1` etc. when collisions exist; covered by existing test, not @scenario bound. |
| specs/variables-ui/variables-section.feature | "Edit variable name by clicking" | KEEP | Clicking name sets `editingId`; existing test verifies edit-mode entry, not bound. |
| specs/variables-ui/variables-section.feature | "Save variable name on blur" | KEEP | `Input.onBlur={handleSave}` saves edits; existing test verifies. |
| specs/variables-ui/variables-section.feature | "Save variable name on Enter" | KEEP | `handleKeyDown` calls `handleSave()` on Enter. |
| specs/variables-ui/variables-section.feature | "Cancel variable name edit on Escape" | KEEP | Escape resets `editValue` to `variable.identifier` then `onEndEdit`. |
| specs/variables-ui/variables-section.feature | "Normalize variable names" | KEEP | `normalizeIdentifier` maps spaces→underscores and lowercases; existing test verifies. |
| specs/variables-ui/variables-section.feature | "Prevent duplicate variable names" | UPDATE | Duplicate prevention exists (returns false from `handleUpdateVariable`) and shows hasError red border for 2s, but no explicit "error message" UI element appears — spec wording overstates. |
| specs/variables-ui/variables-section.feature | "Change variable type via dropdown" | UPDATE | Type changes via a NativeSelect under the type icon, not a separate "type selector dropdown" — spec phrasing differs from UI. |
| specs/variables-ui/variables-section.feature | "Delete variable" | KEEP | Delete button calls `handleRemoveVariable`; existing test verifies onChange call. |
| specs/variables-ui/variables-section.feature | "Cannot delete when only one output exists" | DUPLICATE | This is `OutputsSection.tsx` behavior (tooltip "At least one output is required"), not VariablesSection — already implemented in another component, scenario belongs in a hypothetical specs/outputs-ui domain. |
| specs/variables-ui/variables-section.feature | "Show mapping input when mappings enabled" | UPDATE | Mapping input + "=" sign show even when `showMappings=false` (it falls back to value input); the existing test confirms "=" is always rendered. Spec dichotomy is wrong. |
| specs/variables-ui/variables-section.feature | "Hide mapping input when mappings disabled" | UPDATE | Same — "=" sign and an input are rendered regardless of `showMappings`; spec is incorrect about hiding behavior. |
| specs/variables-ui/variables-section.feature | "Mapping dropdown shows available sources" | KEEP | `VariableMappingInput` renders sources grouped on focus; existing tests cover, no @scenario binding. |
| specs/variables-ui/variables-section.feature | "Select mapping from dropdown" | UPDATE | Tag displays `sourceId.path` (e.g. "dataset-1.input"), not "Test Data.input" — spec wording uses source name. |
| specs/variables-ui/variables-section.feature | "Type default value in mapping input" | UPDATE | Typing alone doesn't set a value mapping — user must explicitly select the "use as value" option per `VariableMappingInput.test.tsx`. Spec misses that step. |
| specs/variables-ui/variables-section.feature | "Search filters mapping options" | KEEP | Filter exists in `VariableMappingInput`; existing tests cover, not @scenario bound. |
| specs/variables-ui/variables-section.feature | "Clear mapping" | KEEP | `clear-mapping-button` and Backspace-on-empty paths both call `onMappingChange(undefined)`. |
| specs/variables-ui/variables-section.feature | "Read-only variables cannot be renamed" | KEEP | `readOnly` short-circuits edit mode entry; existing test verifies. |
| specs/variables-ui/variables-section.feature | "Read-only variables cannot be deleted" | KEEP | `canRemove={canAddRemove && !isLocked}` and read-only hides delete; covered. |
| specs/variables-ui/variables-section.feature | "Read-only variables cannot change type" | KEEP | Read-only path renders a static `VariableTypeIcon` with no NativeSelect. |
| specs/variables-ui/variables-section.feature | "Read-only variables can still set mappings" | KEEP | Mapping input is rendered independent of `readOnly` (only `disabledMappings` hides it). |
| specs/variables-ui/variables-section.feature | "Cannot add variables when canAddRemove=false" | KEEP | `shouldShowAddButton = showAddButton ?? canAddRemove` hides Add button. |
| specs/variables-ui/variables-section.feature | "Cannot delete variables when canAddRemove=false" | KEEP | `canRemove={canAddRemove && !isLocked}` removes the X button per row. |
