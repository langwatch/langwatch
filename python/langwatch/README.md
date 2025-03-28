# LangWatch Python SDK 🐍

A Python SDK to monitor and observe your LLM applications using LangWatch.

> [!CAUTION]
> This SDK is currently being developed and is not yet ready for production, or even
> development use.

## Migration progress

### Legend 🦵🔚

-   ✅: Complete
-   🚧: Migration in progress
-   ❌: Pending migration
-   ⚰: Deprecated
-   🗑️: Removed

### Progress breakdown

| Feature                                | Status | Tested | Description                                               |
| -------------------------------------- | ------ | ------ | --------------------------------------------------------- |
| `endpoint`                             | ✅     | 🔄     |                                                           |
| `api_key`                              | 🗑️     | 🔄     | This has been removed.                                    |
| `enabled`                              | ❌     | 🔄     |                                                           |
| `sampling_rate`                        | ❌     | 🔄     |                                                           |
| `logger`                               | ✅     | 🔄     |                                                           |
| `trace`                                | 🚧     | 🔄     |                                                           |
| `span`                                 | 🚧     | 🔄     |                                                           |
| `get_current_trace`                    | ❌     | 🔄     |                                                           |
| `get_current_span`                     | ❌     | 🔄     |                                                           |
| `create_span`                          | 🗑️     | 🔄     | This was marked for deprecation, and has been deprecated. |
| `capture_rag`                          | 🗑️     | 🔄     | This was marked for deprecation, and has been deprecated. |
| `langchain`                            | ❌     | 🔄     |                                                           |
| `dspy`                                 | ❌     | 🔄     |                                                           |
| `login`                                | ❌     | 🔄     |                                                           |
| `evaluations`                          | ❌     | 🔄     |                                                           |
| `guardrails`                           | ❌     | 🔄     |                                                           |
| `openai`                               | ⚰      | 🔄     |                                                           |
| `litellm`                              | ⚰      | 🔄     |                                                           |
| `ContextSpan`                          | 🚧     | 🔄     |                                                           |
| `ContextSpan.update`                   | ❌     | 🔄     |                                                           |
| `ContextSpan.add_evaluation`           | ❌     | 🔄     |                                                           |
| `ContextSpan.evaluate`                 | ❌     | 🔄     |                                                           |
| `ContextSpan.async_evaluate`           | ❌     | 🔄     |                                                           |
| `ContextSpan.end`                      | ❌     | 🔄     |                                                           |
| `ContextTrace`                         | 🚧     | 🔄     |                                                           |
| `ContextTrace.update`                  | ❌     | 🔄     |                                                           |
| `ContextTrace.add_evaluation`          | ❌     | 🔄     |                                                           |
| `ContextTrace.evaluate`                | ❌     | 🔄     |                                                           |
| `ContextTrace.async_evaluate`          | ❌     | 🔄     |                                                           |
| `ContextTrace.deferred_send_spans`     | ❌     | 🔄     |                                                           |
| `ContextTrace.send_spans`              | ❌     | 🔄     |                                                           |
| `ContextTrace.append_span`             | ❌     | 🔄     |                                                           |
| `ContextTrace.get_parent_id`           | ❌     | 🔄     |                                                           |
| `ContextTrace.get_current_span`        | ❌     | 🔄     |                                                           |
| `ContextTrace.set_current_span`        | ❌     | 🔄     |                                                           |
| `ContextTrace.reset_current_span`      | ❌     | 🔄     |                                                           |
| `ContextTrace.get_langchain_callback`  | ❌     | 🔄     |                                                           |
| `ContextTrace.autotrack_openai_calls`  | ⚰      | 🔄     |                                                           |
| `ContextTrace.autotrack_litellm_calls` | ⚰      | 🔄     |                                                           |
| `ContextTrace.autotrack_dspy`          | ❌     | 🔄     |                                                           |
| `ContextTrace.share`                   | ✅     | 🔄     |                                                           |
| `ContextTrace.unshare`                 | ✅     | 🔄     |                                                           |

## Installation

## Usage

## API reference

## Contributing

## License

## Support
