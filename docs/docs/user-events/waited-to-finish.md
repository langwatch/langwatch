---
title: Waited To Finish Events
sidebar_position: 2
---

# Waited To Finish Events

Waited to finish events are used to determine if users are waiting for the LLM application to finish generating a response or if they leave before it's completed, this is interesting to capture using impatience with regards to the response generation.

Since the user can simply close the window, to be able to track it, we need to send two requests, first one with `finished` set as `0`, to identify the output has started, and the another one with `finished` set as `1` when the output finishes at client side. If `"finished": 1` is never received, we assume the user didn't let the AI finish.

## REST API Specification

### Endpoint

`POST /api/track_event`

### Headers

- `X-Auth-Token`: Your LangWatch API key.

### Request Body

```javascript
{
  "trace_id": "id of the message the user gave the feedback on",
  "event_type": "waited_to_finish",
  "metrics": {
    "finished": 0 // Call it with 0 on the first request, then with 1 after the messages finishes rendering
  },
  "timestamp": 1617981376000 // Unix timestamp in milliseconds
}
```

### Example

```bash
curl -X POST "https://app.langwatch.ai/api/track_event" \\
     -H "X-Auth-Token: your_api_key" \\
     -H "Content-Type: application/json" \\
     -d '{
       "trace_id": "trace_Yy0XWu6BOwwnrkLtQh9Ji",
       "event_type": "waited_to_finish",
       "metrics": {
         "finished": 0
       },
       "timestamp": 1617981376000
     }'

curl -X POST "https://app.langwatch.ai/api/track_event" \\
     -H "X-Auth-Token: your_api_key" \\
     -H "Content-Type: application/json" \\
     -d '{
       "trace_id": "trace_Yy0XWu6BOwwnrkLtQh9Ji",
       "event_type": "waited_to_finish",
       "metrics": {
         "finished": 1
       },
       "timestamp": 1617981378000
     }'
```
