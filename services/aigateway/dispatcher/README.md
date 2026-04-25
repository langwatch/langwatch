# aigateway/dispatcher

In-process Go entry point that wraps the AI gateway's provider router (Bifrost). Lets internal services talk to providers without going through the HTTP layer of the gateway, while reusing the same provider routing, error classification, and streaming behavior.

## Why this exists

The langwatch_nlp → Go migration (see `specs/nlp-go/`) needs to dispatch chat / messages / responses / embeddings calls from Lambda. The Lambda lives in an isolated VPC with no network path back to the cluster, so calling the gateway over HTTP would require a public hop and a separate auth bridge (HMAC + inline-credentials). Importing the gateway as a library makes all of that disappear:

- one process, no public hop, no fourth server
- nlpgo holds per-request customer credentials and passes them to providers directly through Bifrost
- the gateway's HTTP layer stays untouched for direct virtual-key customers

## Surface

```go
disp, err := dispatcher.New(ctx, dispatcher.Options{Logger: logger})
// chat / messages / responses / embeddings
resp, err := disp.Dispatch(ctx, dispatcher.Request{
    Type:       domain.RequestTypeChat,
    Model:      "gpt-5-mini",
    Body:       openAIShapeBytes,
    Credential: domain.Credential{ProviderID: domain.ProviderOpenAI, APIKey: "sk-..."},
})

// streaming
iter, err := disp.DispatchStream(ctx, req)
for iter.Next(ctx) {
    chunk := iter.Chunk()
    // ...
}
iter.Close()

// raw-forward (Gemini /v1beta/...)
resp, err := disp.Passthrough(ctx, dispatcher.PassthroughRequest{
    Request: dispatcher.Request{ ... },
    HTTP:    domain.PassthroughRequest{Method: "POST", Path: "/models/...:generateContent"},
})
```

## What it does NOT do

The gateway HTTP layer wraps `dispatcher` with a pipeline of interceptors (auth resolver → rate limiter → policy → model resolver → cache → budget → guardrail → trace). The dispatcher is **bare**: just provider routing + retry + streaming. Internal callers that need any of those concerns should add them above the dispatcher; for nlpgo, none apply (no virtual keys, no per-call rate limits, no centralized budget).

## Compared to the HTTP layer

| Concern | HTTP layer | Dispatcher |
|---|---|---|
| Auth | VK resolver | caller-supplied `domain.Credential` |
| Rate limit | yes | no |
| Budget | yes | no |
| Cache rules | yes | no |
| Guardrails | yes | no |
| Provider routing | Bifrost | Bifrost |
| Error classification | yes | yes |
| Streaming raw bytes | yes | yes |

## Consumers

- `services/nlpgo/adapters/dispatcheradapter` — bridges `app.GatewayClient` (the legacy nlpgo port) onto the dispatcher. Parses the inline-credentials header that `llmexecutor` sets, builds a `domain.Credential`, and calls `Dispatch`. Will eventually be flattened to pass `Credential` directly without the header dance.

## Adding a new entry point

If you need a different request shape (e.g. a future Anthropic-native passthrough beyond `/v1/messages`), add a method on `Dispatcher` that forwards to `providers.BifrostRouter.Dispatch` with the right `domain.RequestType` and any extra metadata. Keep the surface narrow — anything that needs auth/budget/cache belongs above this layer.
