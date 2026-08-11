package providers

import (
	"context"
	"testing"
	"time"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

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
		// config this provider is handed. Nil where the gateway sends the
		// vendor no deployments at all — see the Vertex row.
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
				return key.AzureKeyConfig.Deployments
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
				return key.BedrockKeyConfig.Deployments
			},
		},
		{
			// bfschemas.VertexKeyConfig carries a Deployments field, but
			// credentialToBifrostKey's Vertex arm does not populate it. That
			// gap predates this change and is outside its scope, so the vendor
			// half is left unasserted here rather than asserted wrongly. The
			// credential half below still has to hold: it is the value a fix
			// to that gap would forward.
			name: "vertex",
			cred: domain.Credential{
				ID:         "cred-vertex",
				ProviderID: domain.ProviderVertex,
				Extra:      map[string]string{"project_id": "proj", "region": "us-central1"},
			},
			provider: bfschemas.Vertex,
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

			if tc.keyDeployments == nil {
				return
			}
			assert.Equal(t, got.DeploymentMap, tc.keyDeployments(t, credentialToBifrostKey(got, tc.provider)),
				"the resolved map must reach the vendor key config, not stop at the credential")
		})
	}
}

// AC11: the chokepoint sits above the lane switch, so every request type has to
// clear Azure's key validation, not only chat completions. Each row asserts on
// the path the Azure resource was actually asked for: reaching it at all is the
// claim, because Bifrost rejects a nil deployments map inside every one of
// these provider methods before it dials (core@v1.4.22 azure.go
// validateKeyConfig). Removing the self-map turns all seven rows red.
//
// The stub answers the streaming lane with SSE and every other lane with the
// same non-streaming chat-completion body. Only the chat-completion lane can
// decode that reply; the other five are asking for a shape it is not — a
// Responses reply, an embedding vector, audio bytes — so they fail to decode.
// Dispatch results are deliberately not asserted on any lane: what this test
// claims is what left the gateway, and both the decode failures and the one
// success happen after the dial it asserts on.
//
// @scenario "Every dispatch lane resolves the deployment, not only chat"
func TestAzureDispatch_EveryLaneResolvesTheDeployment(t *testing.T) {
	// The request model as a client sends it, and the model Dispatch hands
	// Bifrost once resolution has stripped the provider prefix. The deployment
	// is looked up under the latter, so it is also the path segment below.
	const (
		reqModel = "azure/gpt-5.3-mini"
		bfModel  = "gpt-5.3-mini"
	)

	cases := []struct {
		lane     string
		reqType  domain.RequestType
		body     string
		upload   *domain.TranscriptionUpload
		stream   bool
		wantPath string
	}{
		{
			lane:     "chat completion",
			reqType:  domain.RequestTypeChat,
			body:     `{"model":"azure/gpt-5.3-mini","messages":[{"role":"user","content":"hi"}]}`,
			wantPath: "/openai/deployments/" + bfModel + "/chat/completions",
		},
		{
			lane:     "streaming chat completion",
			reqType:  domain.RequestTypeChat,
			body:     `{"model":"azure/gpt-5.3-mini","messages":[{"role":"user","content":"hi"}],"stream":true}`,
			stream:   true,
			wantPath: "/openai/deployments/" + bfModel + "/chat/completions",
		},
		{
			// Azure's Responses route carries the deployment in the body
			// rather than the path, so the path is fixed and reaching it is
			// the whole assertion for this lane.
			lane:     "responses",
			reqType:  domain.RequestTypeResponses,
			body:     `{"model":"azure/gpt-5.3-mini","input":"hi"}`,
			wantPath: "/openai/v1/responses",
		},
		{
			lane:     "embeddings",
			reqType:  domain.RequestTypeEmbeddings,
			body:     `{"model":"azure/gpt-5.3-mini","input":"hi"}`,
			wantPath: "/openai/deployments/" + bfModel + "/embeddings",
		},
		{
			// Azure does not speak the Anthropic wire format, so /v1/messages
			// is translated onto the neutral Responses request and lands on
			// the Responses route.
			lane:     "translated messages",
			reqType:  domain.RequestTypeMessages,
			body:     `{"model":"azure/gpt-5.3-mini","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}`,
			wantPath: "/openai/v1/responses",
		},
		{
			lane:     "audio speech",
			reqType:  domain.RequestTypeSpeech,
			body:     `{"model":"azure/gpt-5.3-mini","input":"hi","voice":"alloy"}`,
			wantPath: "/openai/deployments/" + bfModel + "/audio/speech",
		},
		{
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
				// is drained to completion before the recorded path is read.
				it, err := router.DispatchStream(context.Background(), req, cred)
				require.NoError(t, err, "the streaming lane must open against an SSE upstream")
				drainStream(t, it)
			} else {
				_, _ = router.Dispatch(context.Background(), req, cred)
			}

			assert.Equal(t, tc.wantPath, firstUpstreamPath(t, stub),
				"the %s lane must resolve a deployment for %q, the same as chat", tc.lane, bfModel)
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
