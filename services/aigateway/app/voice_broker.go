package app

import (
	"context"
	"time"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/app/pipeline"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// admitBrokeredCall takes the supervision slot of a brokered call before it
// is booked. A plain mint needs none and gets a slot that does nothing.
func (a *App) admitBrokeredCall(
	ctx context.Context,
	call *pipeline.Call,
	session *domain.RealtimeSessionRequest,
) (domain.VoiceSlot, error) {
	if session.Broker == "" {
		return noVoiceSlot{}, nil
	}
	if a.voice == nil {
		return nil, herr.New(ctx, domain.ErrVoiceBrokerUnavailable, herr.M{
			"message": "brokered voice calls are not available on this gateway: no call supervisor is configured",
			"fault":   "gateway",
		})
	}
	if err := a.checkDelegatedModel(ctx, call); err != nil {
		return nil, err
	}
	return a.voice.Admit(ctx, session.Kind())
}

// checkDelegatedModel holds the backend model of a Live session to the key's
// model allowlist and policy rules. It spends the same provider key as the
// session, so naming it in the body must not be a way around either.
func (a *App) checkDelegatedModel(ctx context.Context, call *pipeline.Call) error {
	model := domain.LiveDelegatedModel(call.Request.Body)
	if model == "" {
		return nil
	}
	config := call.Bundle.Config
	if !config.AllowsResolvedModel(domain.ProviderOpenAI, model) {
		return herr.New(ctx, domain.ErrModelNotAllowed, herr.M{
			"message": "model not allowed: " + model + " (the model this session delegates responses to)",
			"fault":   "customer",
		})
	}
	if a.policy == nil || len(config.PolicyRules) == 0 {
		return nil
	}
	return a.policy.CheckModel(ctx, config.PolicyRules, domain.ResolvedModel{
		ProviderID: domain.ProviderOpenAI,
		ModelID:    model,
	})
}

// brokeredCall is what the supervisor needs of a call that was just set up.
func brokeredCall(call *pipeline.Call, cred domain.Credential, resp *domain.Response) domain.BrokeredVoiceSession {
	session := call.Request.RealtimeSession
	return domain.BrokeredVoiceSession{
		SessionID:       session.SessionID,
		Kind:            session.Kind(),
		VendorSessionID: resp.RealtimeConversationID,
		Credential:      cred,
		Bundle:          call.Bundle,
		StartedAt:       time.Now(),
	}
}

type noVoiceSlot struct{}

func (noVoiceSlot) Start(domain.BrokeredVoiceSession)                    {}
func (noVoiceSlot) Abandon(context.Context, domain.BrokeredVoiceSession) {}
func (noVoiceSlot) Release()                                             {}
