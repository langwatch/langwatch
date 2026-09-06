package providers

import (
	"context"
	"testing"
	"time"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Defect A was reported against Azure chat completions, but neither the
// provider nor the lane is special: every deployment-routed provider and every
// dispatch lane reads the same credential through the same chokepoint. These
// two tests hold the two axes the report did not cover, so a fix that happens
// to work for Azure chat cannot pass while Bedrock, Vertex, or /v1/embeddings
// still dispatch with a nil map.
//
// Spec: specs/ai-gateway/azure-deployment-map-control-plane-path.feature

// AC9: Bedrock and Vertex route on deployment too, and reach dispatch from the
// same control-plane wire with the same nil map (pinned on the wire side in
// adapters/controlplane/config_wire_deployment_map_test.go). If the chokepoint
// covered Azure alone, the next report would be this defect under another
// provider's name.
//
// @scenario "Deployment-mapped providers all receive the self-map on this path"
func TestDispatchCredential_DeploymentMappedProvidersAllGetTheSelfMap(t *testing.T) {
	const model = "gpt-5.3-mini"

	cases := []struct {
		name     string
		cred     domain.Credential
		provider bfschemas.ModelProvider
		// keyDeployments reads the deployments map back off the vendor key
		// config this provider is handed.
		keyDeployments func(t *testing.T, key bfschemas.Key) map[string]string
	}{
		{
			name: "azure",
			cred: domain.Credential{
				ID:         "cred-azure",
				ProviderID: domain.ProviderAzure,
				APIKey:     "az-key",
				Extra:      map[string]string{"endpoint": "https://acme.openai.azure.com"},
			},
			provider: bfschemas.Azure,
			keyDeployments: func(t *testing.T, key bfschemas.Key) map[string]string {
				t.Helper()
				require.NotNil(t, key.AzureKeyConfig, "azure must be handed a key config")
				// bifrost v1.5 moved model->deployment mapping onto Key.Aliases.
				return map[string]string(key.Aliases)
			},
		},
		{
			name: "bedrock",
			cred: domain.Credential{
				ID:         "cred-bedrock",
				ProviderID: domain.ProviderBedrock,
				Extra:      map[string]string{"access_key": "AK", "secret_key": "SK", "region": "us-east-1"},
			},
			provider: bfschemas.Bedrock,
			keyDeployments: func(t *testing.T, key bfschemas.Key) map[string]string {
				t.Helper()
				require.NotNil(t, key.BedrockKeyConfig, "bedrock must be handed a key config")
				// bifrost v1.5 moved model->deployment mapping onto Key.Aliases.
				return map[string]string(key.Aliases)
			},
		},
		{
			name: "vertex",
			cred: domain.Credential{
				ID:         "cred-vertex",
				ProviderID: domain.ProviderVertex,
				Extra:      map[string]string{"project_id": "proj", "region": "us-central1"},
			},
			provider: bfschemas.Vertex,
			keyDeployments: func(t *testing.T, key bfschemas.Key) map[string]string {
				t.Helper()
				require.NotNil(t, key.VertexKeyConfig, "vertex must be handed a key config")
				// bifrost v1.5 moved model->deployment mapping onto Key.Aliases.
				return map[string]string(key.Aliases)
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			require.Nil(t, tc.cred.DeploymentMap,
				"fixture precondition: the control-plane wire supplies no deployment map for this slot")

			got := dispatchCredential(tc.cred, model)

			require.NotEmpty(t, got.DeploymentMap[model],
				"%s routes on deployment name; the chokepoint must resolve one for %q", tc.name, model)
			assert.Equal(t, model, got.DeploymentMap[model],
				"with no explicit deployment configured, the model id is the deployment name")

			assert.Equal(t, got.DeploymentMap, tc.keyDeployments(t, credentialToBifrostKey(got, tc.provider, nil)),
				"the resolved map must reach the vendor key config, not stop at the credential")
		})
	}
}

// AC11: the chokepoint sits above the lane switch, so every request type has to
// clear Azure's key validation, not only chat completions. Removing the self-map
// turns all seven rows red.
//
// bifrost v1.5.17 flattened most Azure routes to /openai/v1/... and the resolved
// model now rides on the request body's "model" field rather than a URL
// deployment segment. Where the value comes from differs by lane, so each row
// asserts on the surface its own lane actually carries it:
//   - parsed lanes (embeddings, translated messages, audio speech) re-marshal
//     the request from bifrost's structured form after req.SetModel, so the
//     body's "model" is bifrost's resolved value (bifrost.go:6086/6145).
//   - raw-forward lanes (chat, streaming chat, responses) forward the request
//     body verbatim — req.SetModel updates only the struct, never the raw body
//     (core CheckAndGetRawRequestBody returns it unmodified) — so the resolved
//     model is the one the gateway already wrote into that body before dispatch
//     (app/pipeline resolve.go rewriteResolvedModel). This test hands it the
//     resolved model directly, as the pipeline would.
//   - audio transcription is the lone lane still routed by a deployment path
//     (/openai/deployments/{X}/audio/transcriptions, azure.go:1212), so its
//     wantPath segment is the resolution proof and its body carries no model.
//
// This test uses no deployment map, so the deployment equals the model id and
// the value expected on the wire is bfModel on every lane. The deployment-map
// PRECEDENCE (a wired entry outranking the model id) is exercised by
// TestAzureDispatch_ResolvesDeploymentForControlPlaneCredential; see the note
// there on the raw-forward lanes.
//
// The stub answers the streaming lane with SSE and every other lane with the
// same non-streaming chat-completion body. Only the chat-completion lane can
// decode that reply; the others are asking for a shape it is not — a Responses
// reply, an embedding vector, audio bytes — so they fail to decode. Dispatch
// results are deliberately not asserted on any lane: what this test claims is
// what left the gateway, and both the decode failures and the one success
// happen after the dial it asserts on.
//
// @scenario "Every dispatch lane resolves the deployment, not only chat"
func TestAzureDispatch_EveryLaneResolvesTheDeployment(t *testing.T) {
	// The request model the gateway hands Bifrost once resolution has stripped
	// the provider prefix, and the value it has already written into every
	// raw-forward body. With no deployment map, the deployment equals it.
	const (
		reqModel = "gpt-5.3-mini"
		bfModel  = "gpt-5.3-mini"
	)

	cases := []struct {
		lane    string
		reqType domain.RequestType
		body    string
		upload  *domain.TranscriptionUpload
		stream  bool
		// wantPath is the route Bifrost dials for this lane.
		wantPath string
		// wantBodyModel is the deployment the lane must carry in the request
		// body's "model" field. Empty means the lane carries the deployment in
		// the path instead (audio transcription), where wantPath proves it.
		wantBodyModel string
	}{
		{
			lane:          "chat completion",
			reqType:       domain.RequestTypeChat,
			body:          `{"model":"gpt-5.3-mini","messages":[{"role":"user","content":"hi"}]}`,
			wantPath:      "/openai/v1/chat/completions",
			wantBodyModel: bfModel,
		},
		{
			lane:          "streaming chat completion",
			reqType:       domain.RequestTypeChat,
			body:          `{"model":"gpt-5.3-mini","messages":[{"role":"user","content":"hi"}],"stream":true}`,
			stream:        true,
			wantPath:      "/openai/v1/chat/completions",
			wantBodyModel: bfModel,
		},
		{
			lane:          "responses",
			reqType:       domain.RequestTypeResponses,
			body:          `{"model":"gpt-5.3-mini","input":"hi"}`,
			wantPath:      "/openai/v1/responses",
			wantBodyModel: bfModel,
		},
		{
			lane:          "embeddings",
			reqType:       domain.RequestTypeEmbeddings,
			body:          `{"model":"gpt-5.3-mini","input":"hi"}`,
			wantPath:      "/openai/v1/embeddings",
			wantBodyModel: bfModel,
		},
		{
			// Azure does not speak the Anthropic wire format, so /v1/messages
			// is translated onto the neutral Responses request and lands on
			// the Responses route.
			lane:          "translated messages",
			reqType:       domain.RequestTypeMessages,
			body:          `{"model":"gpt-5.3-mini","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}`,
			wantPath:      "/openai/v1/responses",
			wantBodyModel: bfModel,
		},
		{
			lane:          "audio speech",
			reqType:       domain.RequestTypeSpeech,
			body:          `{"model":"gpt-5.3-mini","input":"hi","voice":"alloy"}`,
			wantPath:      "/openai/v1/audio/speech",
			wantBodyModel: bfModel,
		},
		{
			// The lone lane bifrost v1.5.17 still routes on the path, so the
			// deployment segment in wantPath is the resolution proof and the
			// body (multipart, not JSON) carries no "model" field to read.
			lane:     "audio transcription",
			reqType:  domain.RequestTypeTranscription,
			upload:   &domain.TranscriptionUpload{File: []byte("RIFFfake"), Filename: "hi.wav"},
			wantPath: "/openai/deployments/" + bfModel + "/audio/transcriptions",
		},
	}

	for _, tc := range cases {
		t.Run(tc.lane, func(t *testing.T) {
			stub := newAzureResourceStub(t, bfModel)
			router := newTestBifrostRouter(t)

			cred := domain.Credential{
				ID:         "cred-azure",
				ProviderID: domain.ProviderAzure,
				APIKey:     "az-key",
				Extra:      map[string]string{"endpoint": stub.URL, "api_version": "2024-10-21"},
			}
			req := &domain.Request{
				Type:          tc.reqType,
				Model:         reqModel,
				Resolved:      &domain.ResolvedModel{ModelID: bfModel, ProviderID: domain.ProviderAzure, Source: domain.ModelSourceExplicit},
				Body:          []byte(tc.body),
				Transcription: tc.upload,
			}

			if tc.stream {
				// The stub serves this lane real SSE, so the stream opens and
				// is drained to completion before the recorded request is read.
				it, err := router.DispatchStream(context.Background(), req, cred)
				require.NoError(t, err, "the streaming lane must open against an SSE upstream")
				drainStream(t, it)
			} else {
				_, _ = router.Dispatch(context.Background(), req, cred)
			}

			assert.Equal(t, tc.wantPath, firstUpstreamPath(t, stub),
				"the %s lane must dial the resolved route for %q, the same as chat", tc.lane, bfModel)
			if tc.wantBodyModel != "" {
				assert.Equal(t, tc.wantBodyModel, firstUpstreamBodyModel(t, stub),
					"the %s lane must resolve the deployment onto the request body's model field for %q", tc.lane, bfModel)
			}
		})
	}
}

// firstUpstreamPath returns the path of the first request the stub served, and
// fails the test when the dispatch never reached it — the pre-fix outcome,
// where Bifrost rejects the nil deployments map without dialing.
func firstUpstreamPath(t *testing.T, stub *azureResourceStub) string {
	t.Helper()
	stub.mu.Lock()
	defer stub.mu.Unlock()

	require.NotEmpty(t, stub.paths,
		"no request reached the Azure resource: the dispatch was rejected before it dialed")
	return stub.paths[0]
}

// firstUpstreamBodyModel returns the "model" field of the first request body the
// stub served — the resolved deployment for lanes bifrost v1.5.17 routes with a
// flat URL. It fails the test when no request was recorded or the body carried
// no model field.
func firstUpstreamBodyModel(t *testing.T, stub *azureResourceStub) string {
	t.Helper()
	stub.mu.Lock()
	defer stub.mu.Unlock()

	require.NotEmpty(t, stub.bodies,
		"no request reached the Azure resource: the dispatch was rejected before it dialed")
	model := gjson.Get(stub.bodies[0], "model").String()
	require.NotEmpty(t, model, "the upstream request body carried no model field: %s", stub.bodies[0])
	return model
}

// drainStream consumes a stream to completion so the upstream call it wraps has
// finished before the caller reads what the stub recorded. The deadline keeps a
// stream that never terminates from hanging the suite.
func drainStream(t *testing.T, it domain.StreamIterator) {
	t.Helper()
	defer func() { _ = it.Close() }()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	for it.Next(ctx) {
		_ = it.Chunk()
	}
}
