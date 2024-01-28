---
title: Thumbs Up/Down
sidebar_position: 1
---

# Thumbs Up/Down Events

Thumbs up/down events are used to capture user feedback on specific messages or interactions with your chatbot or LLM application, with an optional textual feedback.

You can use those user provided inputs in combination with the automatic sentiment analysis provided by LangWatch to gauge how satisfied your users are with the generated responses, and use this information to get insights, debug, iterate and improve your product.

To use the thumbs_up_down event it's important that you have used an explicit `trace_id` defined on your side when doing the integration. Read more about it on [concepts](../concepts).

## REST API Specification

### Endpoint

`POST /api/track_event`

### Headers

- `X-Auth-Token`: Your LangWatch API key.

### Request Body

```javascript
{
  "trace_id": "id of the message the user gave the feedback on",
  "event_type": "thumbs_up_down",
  "metrics": {
    "vote": 1 // Use 1 for thumbs up, 0 for neutral or undo feedback, and -1 for thumbs down
  },
  "action_details": {
    "feedback": "Optional user feedback text"
  },
  "timestamp": 1617981376000 // Unix timestamp in milliseconds
}
```

The `trace_id` should be the same one used when integrating

### Example

```bash
curl -X POST "https://app.langwatch.ai/api/track_event" \\
     -H "X-Auth-Token: your_api_key" \\
     -H "Content-Type: application/json" \\
     -d '{
       "trace_id": "trace_Yy0XWu6BOwwnrkLtQh9Ji",
       "event_type": "thumbs_up_down",
       "metrics": {
         "vote": 1
       },
       "action_details": {
         "feedback": "This response was helpful!"
       },
       "timestamp": 1617981376000
     }'
```

The `vote` metric is mandatory and must be either `1` or `-1`. The `feedback` field in `action_details` is optional and can be used to provide additional context or comments from the user.