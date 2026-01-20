# Thread Mapping Integration in Evaluation Wizard

## Overview

This document describes the integration of thread-based mapping into the evaluation wizard, allowing users to map grouped traces (by thread_id) for evaluations while maintaining backward compatibility with standard trace mappings.

## Architecture

### Data Flow

1. **User Interface**: Toggle switch in `EvaluatorMappingAccordion` to enable thread mapping
2. **Storage**: Separate `realTimeThreadMappings` and `realTimeTraceMappings` in wizard state
3. **Merging**: Automatic conversion and merge into unified `MappingState` format
4. **Persistence**: Saved to monitor's `mappings` field in database

### Key Components

#### 1. Server-Side Schema (`src/server/tracer/tracesMapping.ts`)

**THREAD_MAPPINGS**

- Defines available thread mapping options (`thread_id`, `traces`)
- Similar structure to TRACE_MAPPINGS but operates on grouped trace data

**mappingStateSchema**

- Unified schema supporting both trace and thread mappings via union type
- Thread mappings include:
  - `type: "thread"` (required)
  - `source`: From THREAD_MAPPINGS
  - `selectedFields`: Array of trace fields to include when source is 'traces'
  - Optional `key` and `subkey` fields

**Utility Functions**

```typescript
// Convert thread UI format to unified format
convertThreadMappingsToUnified(threadMapping: ThreadMappingState): MappingState

// Merge thread and trace mappings (thread takes precedence)
mergeThreadAndTraceMappings(
  traceMapping: MappingState | undefined,
  threadMapping: ThreadMappingState | undefined,
  isThreadMapping: boolean
): MappingState
```

#### 2. Wizard State (`useEvaluationWizardStore.ts`)

Added fields:

- `isThreadMapping: boolean` - Toggle state
- `realTimeThreadMappings` - Thread mapping configuration
  - Structure matches `ThreadMappingState` from UI

#### 3. UI Component (`EvaluatorMappingAccordion.tsx`)

**Features**:

- Toggle switch to enable/disable thread mapping (only for real-time tasks)
- Conditional rendering: Shows `ThreadMapping` or `EvaluatorTracesMapping` based on toggle
- Fetches thread-grouped traces when thread mapping is enabled
- Auto-merges thread mappings into `realTimeTraceMappings` via useEffect

**Auto-Merge Logic**:

```typescript
useEffect(() => {
  if (!isThreadMapping) return;

  const merged = mergeThreadAndTraceMappings(
    traceMappings,
    threadMappings,
    isThreadMapping
  );

  // Update realTimeTraceMappings if changed
  if (/* has changes */) {
    setWizardState({ realTimeTraceMappings: merged });
  }
}, [isThreadMapping, threadMappings, traceMappings]);
```

## Data Structure

### Thread Mapping (UI Format)

```typescript
{
  mapping: {
    [targetField: string]: {
      source: "thread_id" | "traces" | "",
      selectedFields?: string[]  // e.g., ["input", "output", "trace_id"]
    }
  }
}
```

### Unified Mapping (Database Format)

```typescript
{
  mapping: {
    [targetField: string]: {
      type: "thread",
      source: "thread_id" | "traces",
      selectedFields: string[],
      key?: string,
      subkey?: string
    } | {
      type: "trace" | undefined,
      source: keyof TRACE_MAPPINGS,
      key?: string,
      subkey?: string
    }
  },
  expansions: string[]
}
```

## Save Flow

1. User configures thread mappings in wizard
2. `useEffect` automatically merges thread mappings into `realTimeTraceMappings`
3. Wizard saves experiment with `workbenchState` containing merged mappings
4. When saving as monitor (`experiments.saveAsMonitor`):
   ```typescript
   monitor.mappings = workbenchState.realTimeTraceMappings;
   ```
5. Monitor table stores unified mapping format with both trace and thread types

## Backward Compatibility

- Existing trace-only mappings continue to work unchanged
- `type: "trace"` is optional for trace mappings (defaults to trace)
- `type: "thread"` is required for thread mappings
- Thread mappings take precedence when both exist for same field

## UI Overflow Fix

Added `overflow="visible"` to:

- `StepAccordion` component (`Accordion.Item` and `Accordion.ItemContent`)
- Container VStacks in `EvaluatorMappingAccordion`
- This prevents dropdown menus from being clipped by accordion boundaries

## Usage Example

1. User creates real-time evaluation
2. Enables "Use thread-based mapping" toggle
3. Maps fields:
   - `thread_id` → `conversation_id`
   - `traces` → `messages` (with selectedFields: ["input", "output"])
4. Saves as monitor
5. Monitor's `mappings` field contains:

```json
{
  "mapping": {
    "conversation_id": {
      "type": "thread",
      "source": "thread_id",
      "selectedFields": []
    },
    "messages": {
      "type": "thread",
      "source": "traces",
      "selectedFields": ["input", "output"]
    }
  },
  "expansions": []
}
```

## Evaluation Worker Implementation

### Thread-Based Evaluation Flow

When a monitor with thread mappings evaluates a trace:

1. **Detection**: `hasThreadMappings()` checks if any mapping has `type: "thread"`
2. **Fetch Thread**: If detected, `getTracesGroupedByThreadId()` fetches all traces with the same `thread_id`
3. **Extract Data**: `buildThreadData()` processes each mapping:
   - **Thread mappings**: Extract thread_id or array of trace field values
   - **Trace mappings**: Use current trace (allows mixed mapping)
4. **Evaluate**: Pass the combined data structure to the evaluator

### Key Functions

#### `hasThreadMappings(mappingState: MappingState): boolean`

- Checks if any mapping configuration has `type === "thread"`
- Determines whether to use thread-based or trace-based evaluation

#### `extractThreadFields(traces: Trace[], selectedFields: string[]): Record<string, any>[]`

- Maps over all traces in thread
- Extracts specified fields using TRACE_MAPPINGS
- Returns array of field-value objects

#### `buildThreadData(projectId, trace, mappingState, protections): Promise<Record<string, any>>`

- Fetches all traces in the thread using `getTracesGroupedByThreadId()`
- Processes each mapping based on type:
  - `type: "thread"` + `source: "thread_id"` → Returns thread_id string
  - `type: "thread"` + `source: "traces"` → Returns array of trace field objects
  - No type or `type: "trace"` → Uses current trace with `mapTraceToDatasetEntry()`
- Returns combined data object for evaluator

### Example Evaluation Data

For a monitor with mappings:

```json
{
  "mapping": {
    "conversation_id": {
      "type": "thread",
      "source": "thread_id"
    },
    "messages": {
      "type": "thread",
      "source": "traces",
      "selectedFields": ["input", "output", "timestamp"]
    },
    "user_query": {
      "source": "input"
    }
  }
}
```

The evaluator receives:

```json
{
  "conversation_id": "thread_abc123",
  "messages": [
    {
      "input": "Hello",
      "output": "Hi there!",
      "timestamp": "2025-01-01T10:00:00Z"
    },
    {
      "input": "How are you?",
      "output": "I'm doing well!",
      "timestamp": "2025-01-01T10:01:00Z"
    }
  ],
  "user_query": "Hello"
}
```

### Performance Considerations

- Thread traces are fetched with `size: 1000` limit
- Includes spans when needed for evaluation
- Cached per evaluation job (not across jobs)
- Only fetches when thread mappings are detected

## Batch Evaluation (Wizard) - TODO

### Current State

Thread mapping UI is available in the wizard, but batch evaluation execution is NOT YET implemented.

### How Batch Evaluation Currently Works

1. User clicks "Run Evaluation" in wizard
2. Frontend sends entire `workflow` DSL via `postEvent` (type: `execute_evaluation`)
3. Python backend (`execute_evaluation.py`) processes it:
   - Reads dataset entries (from inline or API)
   - Creates `dspy.Example` objects directly from raw entries (line 124)
   - Evaluates each example
4. **Problem**: Dataset entries are passed RAW - no thread field processing!

### Dataset Structure Example

**Before (raw dataset cell)**:

```json
{
  "conversation_id": "conv_123",
  "messages": "[{\"input\": \"Hi\", \"output\": \"Hello!\"}, {\"input\": \"How?\", \"output\": \"Good!\"}]"
}
```

**After thread field processing (needed)**:

```json
{
  "conversation_id": "conv_123",
  "messages": [
    { "input": "Hi", "output": "Hello!" },
    { "input": "How?", "output": "Good!" }
  ]
}
```

### Implementation Plan

The workflow DSL contains evaluator input edges that map dataset fields to evaluator inputs. For batch evaluations with thread mapping, we need to:

1. **Store thread field metadata in Entry node**

   - Add `thread_field_config` to Entry node data
   - Marks which dataset fields are thread fields
   - Specifies which subfields to extract

2. **Preprocess dataset entries in Python** (`execute_evaluation.py`)

   ```python
   # After line 81 (fetching entries)
   entries = [entry.entry for entry in dataset.entries]

   # NEW: Preprocess thread fields
   if hasattr(entry_node.data, 'thread_field_config'):
       entries = [
           preprocess_thread_fields(entry, entry_node.data.thread_field_config)
           for entry in entries
       ]
   ```

3. **Add preprocessing helper in Python**:

   ```python
   def preprocess_thread_fields(
       entry: Dict[str, Any],
       thread_config: Dict[str, Dict[str, Any]]
   ) -> Dict[str, Any]:
       """Parse JSON and extract fields for thread-mapped columns."""
       result = entry.copy()

       for field_name, config in thread_config.items():
           if not config.get("is_thread_field"):
               continue

           field_value = entry.get(field_name)
           if not field_value:
               continue

           # Parse JSON string to array
           parsed = json.loads(field_value) if isinstance(field_value, str) else field_value

           # Extract selected fields from each object
           selected = config.get("selected_fields", [])
           if selected:
               result[field_name] = [
                   {k: item.get(k) for k in selected}
                   for item in parsed
               ]
           else:
               result[field_name] = parsed

       return result
   ```

4. **Update wizard to populate Entry node config**
   - When `isThreadMapping` is true, convert `realTimeThreadMappings` to `thread_field_config`
   - Store in Entry node before saving experiment/running evaluation

### Files to Modify

- `langwatch_nlp/studio/execute/execute_evaluation.py` - Add preprocessing
- `langwatch/src/components/evaluations/wizard/.../useEvaluationWizardStore.ts` - Add Entry node config logic
- `langwatch/src/optimization_studio/types/dsl.ts` - Add `thread_field_config?` to Entry type

## Future Enhancements

- ✅ Thread mapping for real-time monitoring (DONE)
- ⏳ Thread mapping for batch evaluations (IN PROGRESS - UI done, execution TODO)
- Add caching for thread traces across multiple evaluations
- Support mixed trace/thread field mapping in UI
- Thread-based filtering and grouping in monitoring UI
- Pagination for threads with >1000 traces
