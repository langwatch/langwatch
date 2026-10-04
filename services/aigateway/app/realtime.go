package app

import (
	"context"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/customertracebridge"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/app/pipeline"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// dispatchRealtimeSession is the terminal for a session mint (ADR-097). It
// runs after the whole interceptor chain, so the request has already been
// admitted to spend, rate limited, resolved and checked against the key's
// budget. What is left is the part only this lane has:
//
//  1. pin the credential to the vendor the endpoint names,
//  2. book the session with the control plane, which is where the per-key
//     open-session cap is decided,
//  3. call the vendor's mint,
//  4. record the vendor's conversation id against the booking.
//
// The order matters. Booking before the mint is what makes the cap real: a
// mint that ran first would already have handed out a usable credential by
// the time the count said no. A booking whose mint then fails is released, so
// a vendor outage does not lock the key out of its own cap.
//
// There is no fallback walk. The chain is trimmed to the one vendor the route
// names and the first credential for it serves the mint. A signed URL is
// bound to one agent inside one workspace, so falling through to a second
// credential would sign for an agent that does not exist there, and the
// caller would get a working-looking URL that fails at the socket.
func (a *App) dispatchRealtimeSession(ctx context.Context, call *pipeline.Call) (*domain.Response, error) {
	if err := call.MaterializeBody(); err != nil {
		return nil, err
	}
	cred, err := a.realtimeCredential(ctx, call)
	if err != nil {
		return nil, err
	}

	session := call.Request.RealtimeSession
	if session == nil {
		return nil, herr.New(ctx, domain.ErrInternal, herr.M{
			"message": "a realtime session request reached dispatch without its session details",
			"fault":   "gateway",
		})
	}
	session.SessionID = call.Meta.GatewayRequestID()

	slot, err := a.admitBrokeredCall(ctx, call, session)
	if err != nil {
		return nil, err
	}
	handedOver := false
	defer func() {
		if !handedOver {
			slot.Release()
		}
	}()

	reservation := domain.RealtimeReservation{
		SessionID:       session.SessionID,
		ProjectID:       call.Bundle.ProjectID,
		OrganizationID:  call.Bundle.OrganizationID,
		VirtualKeyID:    call.Bundle.VirtualKeyID,
		ModelProviderID: cred.ID,
		Vendor:          session.Vendor,
		AgentID:         session.AgentID,
		Model:           resolvedModelID(call.Request),
		RequestedModel:  call.Request.Model,
		TraceID:         customerTraceID(ctx),
		Kind:            session.Kind(),
	}
	meterRealtimeReservation(&reservation, session, call.Request.Body)
	if err := a.reserveRealtimeSession(ctx, reservation); err != nil {
		return nil, err
	}

	call.Meta.Update(func(m *pipeline.Meta) {
		m.DispatchedProviderID = cred.ID
		m.RealtimeSessionID = session.SessionID
	})
	a.metrics.SetRequestLabels(ctx, string(cred.ProviderID), resolvedModelID(call.Request))

	resp, err := a.providers.Dispatch(ctx, call.Request, cred)
	if err == nil && resp != nil && resp.StatusCode >= 400 {
		err = upstreamErrorFromResponse(resp)
		resp = nil
	}
	if err != nil {
		a.releaseRealtimeSession(ctx, reservation, "mint_failed")
		a.metrics.RecordRealtimeMint(string(session.Vendor), "provider_error")
		return nil, stampUpstreamProvider(err, cred)
	}

	brokered := brokeredCall(call, cred, resp)
	brokered.EndUserID = customertracebridge.EndUserID(ctx)
	if err := a.correlateRealtimeSession(ctx, reservation, resp); err != nil {
		handedOver = true
		slot.Abandon(ctx, brokered)
		return nil, a.refuseUncorrelatedMint(ctx, reservation)
	}
	a.metrics.RecordRealtimeMint(string(session.Vendor), "minted")
	handedOver = true
	slot.Start(brokered)
	return resp, nil
}

// realtimeCredential takes the one credential that serves this mint.
//
// coreDispatch hands the chain to retry.Walk, which tolerates an empty slice.
// This lane takes the head of it, so it has to say what an empty chain means
// itself rather than panicking on the request thread.
func (a *App) realtimeCredential(ctx context.Context, call *pipeline.Call) (domain.Credential, error) {
	creds, err := a.candidateChain(ctx, call)
	if err != nil {
		return domain.Credential{}, err
	}
	if len(creds) == 0 {
		return domain.Credential{}, herr.New(ctx, domain.ErrProviderNotBound, herr.M{
			"message": "no provider credential on this key can mint a realtime voice session for the vendor this endpoint names",
			"fault":   "customer",
		})
	}
	return creds[0], nil
}

// refuseUncorrelatedMint discards a credential the vendor issued but nothing
// can bill against.
//
// The booking is released so the refusal does not also cost the key a cap
// slot, and the vendor is charged nothing: a signed URL that opens no socket
// is not a conversation.
func (a *App) refuseUncorrelatedMint(ctx context.Context, reservation domain.RealtimeReservation) error {
	a.releaseRealtimeSession(ctx, reservation, "correlation_failed")
	a.metrics.RecordRealtimeMint(string(reservation.Vendor), "correlation_failed")
	return herr.New(ctx, domain.ErrRealtimeRegistryUnavailable, herr.M{
		"message": "the voice session was minted but could not be recorded against its conversation, so it was not issued: retry the request",
		"fault":   "gateway",
	})
}

// reserveRealtimeSession books the session and fails the mint when it cannot.
//
// This fails CLOSED, against the budget doctrine one interceptor above it,
// and the trade is deliberate. A budget precheck that cannot reach the
// control plane lets one request through and reconciles afterwards, because
// the request is bounded and its usage still arrives. A voice session is
// neither: nothing else records that it opened, so an unbooked session is
// spend no ledger will ever see and a cap the next mint cannot count against.
// The mint path already hard-depends on the control plane to resolve the
// virtual key, so refusing here costs no availability the caller had.
func (a *App) reserveRealtimeSession(ctx context.Context, reservation domain.RealtimeReservation) error {
	if a.realtime == nil {
		a.metrics.RecordRealtimeMint(string(reservation.Vendor), "registry_unavailable")
		return herr.New(ctx, domain.ErrRealtimeRegistryUnavailable, herr.M{
			"message": "realtime voice sessions are not available on this gateway: no session registry is configured",
			"fault":   "gateway",
		})
	}
	err := a.realtime.Reserve(ctx, reservation)
	if err == nil {
		return nil
	}
	outcome := "registry_unavailable"
	if herr.IsCode(err, domain.ErrRealtimeSessionLimit) {
		outcome = "session_limit"
		a.metrics.RecordRealtimeSessionLimitBlock()
	} else {
		a.metrics.RecordRealtimeRegistryError("reserve")
	}
	a.metrics.RecordRealtimeMint(string(reservation.Vendor), outcome)
	return err
}

// meterRealtimeReservation states who reports the session's usage and what
// the mint already knows about pricing it.
//
// A hosted agent is left unmetered: the vendor reports its cost after the
// call. Every other session is reported by the client that holds the socket.
func meterRealtimeReservation(reservation *domain.RealtimeReservation, session *domain.RealtimeSessionRequest, body []byte) {
	switch {
	case session.Broker != "":
		reservation.Metering = domain.RealtimeMeteringGateway
		reservation.TranscriptionModel = domain.RealtimeTranscriptionModel(body)
	case session.Vendor == domain.RealtimeVendorOpenAI:
		reservation.Metering = domain.RealtimeMeteringClient
		reservation.TranscriptionModel = domain.RealtimeTranscriptionModel(body)
	case session.TokenType != "":
		reservation.Metering = domain.RealtimeMeteringClient
		reservation.CredentialExpiresAt = time.Now().Add(domain.ElevenLabsSingleUseTokenLifetime)
	}
}

// correlateRealtimeSession records what the mint answer said on the booking:
// the vendor's conversation id and the credential's expiry.
//
// A mint that reported no conversation id still stands: the post-call report
// is matched by the session id echoed back in the conversation's variables,
// and failing that by the one open session in the time window.
//
// A mint that reported one and could not store it does NOT stand, and the
// caller refuses it. That id is the only exact join key between the call and
// its spend record. The reconciler reads back only sessions that have one, so
// a booking that lost it can never be closed by either path, and a real
// conversation would bill as cost-unknown forever. Losing the credential
// costs the caller a retry; keeping it costs the customer a call nobody can
// price.
//
// An expiry that could not be stored is logged and the mint stands. It only
// sizes the estimate for a session that never reports, which falls back to
// the kind's default duration.
func (a *App) correlateRealtimeSession(ctx context.Context, reservation domain.RealtimeReservation, resp *domain.Response) error {
	conversationID, expiresAt := resp.RealtimeConversationID, resp.RealtimeCredentialExpiresAt
	if a.realtime == nil || (conversationID == "" && expiresAt.IsZero()) {
		return nil
	}
	err := a.realtime.Correlate(ctx, domain.RealtimeCorrelation{
		SessionID:            reservation.SessionID,
		ProjectID:            reservation.ProjectID,
		VendorConversationID: conversationID,
		CredentialExpiresAt:  expiresAt,
	})
	if err == nil {
		return nil
	}
	a.metrics.RecordRealtimeRegistryError("correlate")
	if conversationID == "" {
		a.logger.Warn("realtime session minted but its credential expiry was not recorded; the mint stands",
			zap.String("session_id", reservation.SessionID),
			zap.String("project_id", reservation.ProjectID),
			zap.String("vendor", string(reservation.Vendor)),
			zap.Error(err),
		)
		return nil
	}
	a.logger.Warn("realtime session minted but its vendor conversation id was not recorded; the mint is being refused",
		zap.String("session_id", reservation.SessionID),
		zap.String("project_id", reservation.ProjectID),
		zap.String("vendor", string(reservation.Vendor)),
		zap.String("vendor_conversation_id", conversationID),
		zap.Error(err),
	)
	return err
}

// releaseRealtimeSession closes a booking whose mint never produced a
// credential, so the cap stops counting a session that does not exist.
func (a *App) releaseRealtimeSession(ctx context.Context, reservation domain.RealtimeReservation, reason string) {
	if a.realtime == nil {
		return
	}
	if err := a.realtime.Release(ctx, domain.RealtimeRelease{
		SessionID: reservation.SessionID,
		ProjectID: reservation.ProjectID,
		Status:    "FAILED",
		Reason:    reason,
	}); err != nil {
		a.metrics.RecordRealtimeRegistryError("release")
		a.logger.Warn("realtime session reservation was not released after a failed mint",
			zap.String("session_id", reservation.SessionID),
			zap.String("project_id", reservation.ProjectID),
			zap.String("virtual_key_id", reservation.VirtualKeyID),
			zap.String("vendor", string(reservation.Vendor)),
			zap.String("reason", reason),
			zap.Error(err),
		)
	}
}

// customerTraceID is the trace the mint's own span belongs to.
//
// It reads the customer-facing span, not the ambient one: those are two
// different traces, and the settlement has to write its cost into the trace
// the customer actually sees. A brokered call emits no further spans of its
// own, so this is the only way the settlement can find that trace minutes
// later.
func customerTraceID(ctx context.Context) string {
	return customertracebridge.CustomerTraceID(ctx)
}

// resolvedModelID names the model a session bills under: the resolved id
// once resolution has run, the requested one before that.
func resolvedModelID(req *domain.Request) string {
	if req.Resolved != nil {
		return req.Resolved.ModelID
	}
	return req.Model
}

// ReportRealtimeUsage records what a client read off its own socket.
//
// The media socket runs client to vendor, so this is the only path by which
// those numbers reach billing. One post carries one socket event, a batch of
// them, a usage total, or a close. Each event is its own report, keyed by the
// vendor's id for it, so a client can report after every response and a
// resend is recorded once.
//
// The gateway makes the audio and text counts disjoint before forwarding
// them, exactly as it does for every other lane, because audio tokens price
// around eight times text tokens.
//
// A session that never reports still closes: the control plane settles it at
// an estimate for its kind once the open window has passed.
func (a *App) ReportRealtimeUsage(ctx context.Context, bundle *domain.Bundle, report RealtimeUsagePost) (RealtimeUsageAnswer, error) {
	if err := a.requireRealtimeSession(ctx, report.SessionID); err != nil {
		return RealtimeUsageAnswer{}, err
	}
	post, err := domain.ParseRealtimeUsagePost(report.Body)
	if err != nil {
		return RealtimeUsageAnswer{}, herr.New(ctx, domain.ErrBadRequest, herr.M{
			"message": "could not read the usage report: " + err.Error(),
			"fault":   "customer",
		})
	}
	return a.recordRealtimeUsage(ctx, realtimeClientReports(bundle, report.SessionID, post))
}

// CloseRealtimeSession ends a session with no usage to add. What its reports
// already recorded stands.
func (a *App) CloseRealtimeSession(ctx context.Context, bundle *domain.Bundle, closing RealtimeSessionClose) (RealtimeUsageAnswer, error) {
	if err := a.requireRealtimeSession(ctx, closing.SessionID); err != nil {
		return RealtimeUsageAnswer{}, err
	}
	return a.recordRealtimeUsage(ctx, realtimeClientReports(bundle, closing.SessionID, domain.RealtimeUsagePost{
		Final:      true,
		DurationMS: max(closing.DurationMS, 0),
	}))
}

// requireRealtimeSession refuses a report this gateway cannot record.
func (a *App) requireRealtimeSession(ctx context.Context, sessionID string) error {
	if a.realtime == nil {
		return herr.New(ctx, domain.ErrRealtimeRegistryUnavailable, herr.M{
			"message": "realtime voice sessions are not available on this gateway: no session registry is configured",
			"fault":   "gateway",
		})
	}
	if sessionID == "" {
		return herr.New(ctx, domain.ErrBadRequest, herr.M{
			"message": "a session id is required to report usage against",
			"fault":   "customer",
		})
	}
	return nil
}

// recordRealtimeUsage sends the reports of one post to the registry in order
// and answers the last receipt with the costs of the whole post summed.
//
// A post that fails part way is safe to resend: every report before the
// failure is keyed, and the registry records a key once.
func (a *App) recordRealtimeUsage(ctx context.Context, reports realtimeReports) (RealtimeUsageAnswer, error) {
	answer := RealtimeUsageAnswer{SessionID: reports.sessionID, Status: domain.RealtimeReportNoUsage}
	for i := range reports.items {
		receipt, err := a.realtime.ReportUsage(ctx, reports.items[i])
		if err != nil {
			a.metrics.RecordRealtimeRegistryError("usage")
			return RealtimeUsageAnswer{}, err
		}
		answer.Status = receipt.Status
		answer.CostNanoUSD += receipt.CostNanoUSD
		answer.SessionCostNanoUSD = receipt.SessionCostNanoUSD
		answer.Budget = receipt.Budget
	}
	return answer, nil
}

// realtimeReports is one post's reports, bound to the session they are for.
type realtimeReports struct {
	sessionID string
	items     []domain.RealtimeUsageReport
}

// realtimeClientReports turns a client's post into registry reports.
//
// The close rides on the last report, and a post that is only a close is one
// report with no usage. A report with no key and no close is the session
// total; with a close it is one more amount, recorded before the session ends.
func realtimeClientReports(bundle *domain.Bundle, sessionID string, post domain.RealtimeUsagePost) realtimeReports {
	blank := domain.RealtimeUsageReport{
		SessionID:    sessionID,
		ProjectID:    bundle.ProjectID,
		VirtualKeyID: bundle.VirtualKeyID,
		Source:       domain.RealtimeMeteringClient,
	}
	items := make([]domain.RealtimeUsageReport, 0, len(post.Entries)+1)
	for i := range post.Entries {
		report := blank
		report.ReportKey = post.Entries[i].ReportKey
		report.PricedAs = post.Entries[i].PricedAs
		report.Usage = &post.Entries[i].Usage
		items = append(items, report)
	}
	switch {
	case !post.Final:
	case len(items) == 0:
		blank.Final, blank.DurationMS = true, post.DurationMS
		items = append(items, blank)
	default:
		last := &items[len(items)-1]
		last.Final, last.DurationMS = true, post.DurationMS
	}
	return realtimeReports{sessionID: sessionID, items: items}
}
