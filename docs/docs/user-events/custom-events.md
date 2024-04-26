---
title: Custom Events
sidebar_position: 10
---

# Custom Events

Appart from the reserved pre-defined events, you can also define your own events revelant to your business and be captured to correlate with your LLM messages and threads to measure your product performance.

Custom events allow you to track any user interevents with your LLM application by sending numeric metrics and capturing additional details about the event. You can defined any name for the event on `event_type` field, and any metric names you want on `metrics` with numeric values, plus any extra details you want to capture on `event_details` with string values, just keep them consistent to be able to visualize on the dashboard, where you can customize the display later on.

## REST API Specification

### Endpoint

`POST /api/track_event`

### Headers

- `X-Auth-Token`: Your LangWatch API key.

### Request Body

```javascript
{
  "trace_id": "id of the message the event ocurred",
  "event_type": "your_custom_event_type",
  "metrics": {
    "your_metric_key": 123 // Any numeric metric
  },
  "event_details": {
    "your_detail_key": "Any string detail"
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
       "event_type": "add_to_cart",
       "metrics": {
         "amount": 17.5
       },
       "event_details": {
         "product_id": "sku_123",
         "referral_source": "bot_suggested"
       },
       "timestamp": 1617981376000
     }'
```

You can send any event type with corresponding numeric metrics and string details. This flexibility allows you to tailor event tracking to your specific needs.
