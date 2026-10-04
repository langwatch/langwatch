package voicesession

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/coder/websocket"
	"github.com/tidwall/gjson"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/customertracebridge"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const (
	// maxQueuedReports bounds the reports a call holds while the control
	// plane cannot be reached.
	maxQueuedReports = 256
	// maxSeenReportKeys bounds the keys remembered to drop a repeated event.
	maxSeenReportKeys = 4096
	// liveCreationSeconds is what OpenAI Live bills when a session is created.
	liveCreationSeconds = 15
	// eventHeadBytes is how much of a frame is read to learn its type.
	eventHeadBytes = 512
)

// session is one supervised call. Its goroutine owns every field below the
// manager; other goroutines reach it only through the end channel.
type session struct {
	domain.BrokeredVoiceSession
	manager *Manager
	watch   *keyWatch
	// end carries a request to end the call from outside its goroutine.
	end chan string

	meter LiveMeter
	// queue holds keyed reports not yet recorded, oldest first.
	queue []domain.RealtimeUsageReport
	seen  map[string]struct{}

	attached     bool
	lastReported time.Time
	lastChecked  time.Time
}

// requestEnd asks the call's goroutine to end the call. One request is kept.
func (s *session) requestEnd(reason string) {
	select {
	case s.end <- reason:
	default:
	}
}

func (s *session) run() {
	reason := s.supervise()
	s.finalize(reason)
	s.manager.logger.Info("voice_session_ended",
		zap.String("session_id", s.SessionID),
		zap.String("kind", string(s.Kind)),
		zap.String("reason", reason),
		zap.Duration("duration", time.Since(s.StartedAt)),
	)
	s.manager.finished(s, reason)
}

// supervise holds the server-side socket until the call ends, re-attaching
// when the socket drops. A call that cannot be watched is ended.
func (s *session) supervise() string {
	ticker := time.NewTicker(s.manager.timing.Tick)
	defer ticker.Stop()

	retry := reattach{lostAt: s.StartedAt}
	for {
		if reason := s.idle(retry.wait, ticker); reason != "" {
			s.hangup()
			return reason
		}
		reason, again := s.attachOnce(ticker, &retry)
		if !again {
			return reason
		}
	}
}

// reattach is where the supervisor stands in its attempts to attach.
type reattach struct {
	lostAt  time.Time
	attempt int
	wait    time.Duration
}

// attachOnce attaches once and runs the socket. It answers the reason the call
// ended, or again when the socket has to be attached once more.
func (s *session) attachOnce(ticker *time.Ticker, retry *reattach) (reason string, again bool) {
	timing := s.manager.timing
	conn, err := s.attach()
	if err != nil {
		if reason := s.attachFailed(err, retry.lostAt); reason != "" {
			return reason, false
		}
		retry.wait = backoff(timing, retry.attempt)
		retry.attempt++
		return "", true
	}
	s.attached = true
	reason, lost := s.pump(s.open(conn), ticker)
	if lost {
		*retry = reattach{lostAt: time.Now(), attempt: 1, wait: backoff(timing, 0)}
	}
	return reason, lost
}

// attachFailed answers why the call ends after a failed attach, or nothing
// while it is still worth another attempt.
func (s *session) attachFailed(err error, lostAt time.Time) string {
	if errors.Is(err, errCallGone) && s.attached {
		return ReasonVendorClosed
	}
	if time.Since(lostAt) < s.manager.timing.ReattachWindow {
		return ""
	}
	s.manager.logger.Warn("voice_session_sideband_lost",
		zap.String("session_id", s.SessionID), zap.Bool("ever_attached", s.attached), zap.Error(err))
	s.hangup()
	return ReasonSidebandLost
}

func backoff(timing Timing, attempt int) time.Duration {
	if attempt < len(timing.Backoff) {
		return timing.Backoff[attempt]
	}
	return timing.BackoffSteady
}

func (s *session) attach() (*websocket.Conn, error) {
	ctx, cancel := context.WithTimeout(context.Background(), s.manager.timing.CallTimeout)
	defer cancel()
	return s.manager.vendor.Attach(ctx, s.BrokeredVoiceSession)
}

// idle waits with no socket attached. The checks still run, so a budget
// that fills or a key that is revoked ends the call during a re-attach.
func (s *session) idle(wait time.Duration, ticker *time.Ticker) string {
	timer := time.NewTimer(wait)
	defer timer.Stop()
	for {
		select {
		case <-timer.C:
			return ""
		case reason := <-s.end:
			return reason
		case <-ticker.C:
			if reason := s.housekeeping(); reason != "" {
				return reason
			}
		}
	}
}

// link is one attached socket and the goroutine reading it.
type link struct {
	conn   *websocket.Conn
	events chan Event
	lost   chan error
	cancel context.CancelFunc
}

func (l *link) close() {
	l.cancel()
	_ = l.conn.CloseNow()
}

func (s *session) open(conn *websocket.Conn) *link {
	ctx, cancel := context.WithCancel(context.Background())
	l := &link{conn: conn, events: make(chan Event, 64), lost: make(chan error, 1), cancel: cancel}
	go s.read(ctx, l)
	return l
}

// read pulls frames off the socket and passes on the ones that matter.
func (s *session) read(ctx context.Context, l *link) {
	scratch := &frameScratch{head: make([]byte, eventHeadBytes)}
	for {
		event, err := s.readEvent(ctx, l.conn, scratch)
		if err != nil {
			l.lost <- err
			return
		}
		if event.Usage == nil && !event.HasSeconds && !event.Closed {
			continue
		}
		select {
		case l.events <- event:
		case <-ctx.Done():
			return
		}
	}
}

// frameScratch is the reader's buffers, reused for every frame.
type frameScratch struct {
	head  []byte
	frame bytes.Buffer
}

// readEvent reads one frame. A frame that does not matter is discarded as it
// streams in, audio first: it is never buffered whole, parsed, logged or
// stored, and comes back as an empty event.
func (s *session) readEvent(ctx context.Context, conn *websocket.Conn, scratch *frameScratch) (Event, error) {
	head, frame := scratch.head, &scratch.frame
	_, reader, err := conn.Reader(ctx)
	if err != nil {
		return Event{}, err
	}
	n, _ := io.ReadFull(reader, head)
	if s.skips(head[:n]) {
		_, err := io.Copy(io.Discard, reader)
		return Event{}, err
	}
	frame.Reset()
	frame.Write(head[:n])
	if _, err := frame.ReadFrom(reader); err != nil {
		return Event{}, err
	}
	return s.observeFrame(frame.Bytes()), nil
}

// skips reports whether a frame can be dropped from its first bytes alone.
// A head that does not show the type yet is not skipped.
func (s *session) skips(head []byte) bool {
	eventType := PeekEventType(head)
	if eventType == "" {
		return false
	}
	if s.Kind != domain.RealtimeKindLive {
		_, wanted := realtimeUsageEvents[eventType]
		return !wanted
	}
	switch eventType {
	case liveEventUsage, liveEventClosed:
		return false
	case liveEventEnvelope:
		nested := gjson.GetBytes(head, "event.type").String()
		return nested != "" && nested != responsesEventCompleted
	default:
		return true
	}
}

var realtimeUsageEvents = map[string]struct{}{
	"response.done": {},
	"conversation.item.input_audio_transcription.completed": {},
}

func (s *session) observeFrame(frame []byte) Event {
	if s.Kind == domain.RealtimeKindLive {
		return ObserveLiveEvent(frame)
	}
	return ObserveRealtimeEvent(frame)
}

// pump runs one attached socket. It answers the reason the call ended, or
// lost when only the socket went and the call may still be running.
func (s *session) pump(l *link, ticker *time.Ticker) (reason string, lost bool) {
	defer l.close()
	for {
		select {
		case event := <-l.events:
			if reason, ended := s.onEvent(l, event); ended {
				return reason, false
			}
		case err := <-l.lost:
			return s.onLost(l, err)
		case <-ticker.C:
			if reason := s.housekeeping(); reason != "" {
				return s.endCall(l, reason), false
			}
		case reason := <-s.end:
			return s.endCall(l, reason), false
		}
	}
}

func (s *session) onEvent(l *link, event Event) (reason string, ended bool) {
	if s.record(event) {
		return ReasonVendorClosed, true
	}
	if reason := s.flush(false); reason != "" {
		return s.endCall(l, reason), true
	}
	return "", false
}

// onLost tells a socket the vendor closed, which ends the call, from one
// that only dropped.
func (s *session) onLost(l *link, err error) (reason string, lost bool) {
	if s.drainEvents(l) || websocket.CloseStatus(err) != -1 {
		return ReasonVendorClosed, false
	}
	s.manager.logger.Info("voice_session_sideband_dropped",
		zap.String("session_id", s.SessionID), zap.Error(err))
	return "", true
}

// drainEvents records what the reader passed on before the socket went, and
// reports whether the vendor closed the session among it.
func (s *session) drainEvents(l *link) bool {
	closed := false
	for {
		select {
		case event := <-l.events:
			closed = s.record(event) || closed
		default:
			return closed
		}
	}
}

// record keeps what one event measured and reports whether it closed the
// session. A response or item already seen is not queued twice.
func (s *session) record(event Event) bool {
	if event.HasSeconds {
		s.meter.Observe(event.Seconds)
	}
	if event.Usage != nil {
		s.enqueue(*event.Usage)
	}
	return event.Closed
}

func (s *session) enqueue(observation Observation) {
	if _, dup := s.seen[observation.ReportKey]; dup {
		return
	}
	if len(s.queue) >= maxQueuedReports {
		s.manager.metrics.RecordVoiceUsageReport("dropped")
		s.manager.logger.Error("voice_session_report_queue_overflow",
			zap.String("session_id", s.SessionID), zap.String("report_key", observation.ReportKey))
		return
	}
	if len(s.seen) >= maxSeenReportKeys {
		clear(s.seen)
	}
	s.seen[observation.ReportKey] = struct{}{}
	s.queue = append(s.queue, s.report(observation))
}

func (s *session) report(observation Observation) domain.RealtimeUsageReport {
	usage := observation.Usage
	report := domain.RealtimeUsageReport{
		SessionID: s.SessionID,
		ReportKey: observation.ReportKey,
		PricedAs:  observation.PricedAs,
		Model:     observation.Model,
		Usage:     &usage,
		Source:    domain.RealtimeMeteringGateway,
	}
	if s.Bundle != nil {
		report.ProjectID, report.VirtualKeyID = s.Bundle.ProjectID, s.Bundle.VirtualKeyID
	}
	return report
}

// flush sends what is waiting and answers why the call must end, if it must.
// A report that fails stays where it is and is sent again on the next flush.
func (s *session) flush(force bool) string {
	sent, reason := 0, ""
	for len(s.queue) > 0 {
		receipt, err := s.send(s.queue[0])
		if err != nil {
			return reason
		}
		s.queue = s.queue[1:]
		sent++
		reason = firstReason(reason, receiptReason(receipt))
	}
	if delta, ok := s.meter.Pending(time.Now(), s.manager.timing.UsageInterval, force); ok {
		receipt, err := s.send(s.report(delta))
		if err != nil {
			return reason
		}
		s.meter.Ack()
		sent++
		reason = firstReason(reason, receiptReason(receipt))
	}
	if reason == "" && sent > 0 {
		reason = s.budgetReason(false)
	}
	return reason
}

func firstReason(current, next string) string {
	if current != "" {
		return current
	}
	return next
}

// receiptReason reads a usage receipt for a reason to end the call. An
// unknown budget state is no verdict.
func receiptReason(receipt domain.RealtimeUsageReceipt) string {
	switch {
	case receipt.Status == domain.RealtimeReportAlreadyClosed:
		return ReasonSessionClosed
	case receipt.Budget.Exceeded && !receipt.Budget.Unknown:
		return ReasonBudgetExceeded
	default:
		return ""
	}
}

func (s *session) send(report domain.RealtimeUsageReport) (domain.RealtimeUsageReceipt, error) {
	ctx, cancel := context.WithTimeout(context.Background(), s.manager.timing.CallTimeout)
	defer cancel()
	receipt, err := s.manager.registry.ReportUsage(ctx, report)
	// A session the control plane does not have open cannot take a report,
	// now or on a retry, which is the same answer as one it already closed.
	if err != nil && herr.IsCode(err, domain.ErrNotFound) {
		receipt, err = domain.RealtimeUsageReceipt{Status: domain.RealtimeReportAlreadyClosed}, nil
	}
	if err != nil {
		s.manager.metrics.RecordVoiceUsageReport("error")
		s.manager.logger.Warn("voice_session_report_failed",
			zap.String("session_id", s.SessionID), zap.String("report_key", report.ReportKey), zap.Error(err))
		return receipt, err
	}
	s.lastReported = time.Now()
	s.manager.metrics.RecordVoiceUsageReport(string(receipt.Status))
	return receipt, nil
}

// housekeeping runs on every tick: it retries reports, keeps a quiet Live
// session from being taken for a lost one, and checks the key and its budget.
func (s *session) housekeeping() string {
	if reason := s.flush(false); reason != "" {
		return reason
	}
	now := time.Now()
	if s.Kind == domain.RealtimeKindLive && len(s.queue) == 0 &&
		now.Sub(s.lastReported) >= s.manager.timing.KeepAlive {
		s.enqueue(Observation{ReportKey: fmt.Sprintf("hb-%d", int64(now.Sub(s.StartedAt).Seconds()))})
		if reason := s.flush(false); reason != "" {
			return reason
		}
	}
	if now.Sub(s.lastChecked) < s.manager.timing.BudgetInterval {
		return ""
	}
	s.lastChecked = now
	return s.budgetReason(true)
}

// budgetReason runs the gateway's own budget precheck against the key's
// bundle, re-reading the key first when refresh is set.
func (s *session) budgetReason(refresh bool) string {
	if s.watch == nil {
		return ""
	}
	bundle := s.watch.bundle
	if refresh {
		var revoked bool
		if bundle, revoked = s.watch.current(s.manager, time.Now()); revoked {
			return ReasonKeyRevoked
		}
	}
	if s.manager.budget == nil || !s.overBudget(bundle) {
		return ""
	}
	return ReasonBudgetExceeded
}

// overBudget reports whether the precheck blocks the key, or the credential
// this call runs on. A precheck that fails says nothing.
func (s *session) overBudget(bundle *domain.Bundle) bool {
	ctx := context.Background()
	if s.EndUserID != "" {
		ctx = customertracebridge.WithEndUserID(ctx, s.EndUserID)
	}
	decision, err := s.manager.budget(ctx, bundle)
	if err != nil {
		return false
	}
	for i := range decision.ExcludedProviders {
		if decision.ExcludedProviders[i].ProviderKey == s.Credential.ID {
			return true
		}
	}
	return decision.Verdict == domain.BudgetBlock
}

// endCall ends the call at the vendor. A Live call is asked to close on its
// socket first, which reports the final duration; the hangup route follows
// when that is not confirmed in time.
func (s *session) endCall(l *link, reason string) string {
	s.manager.logger.Info("voice_session_ending",
		zap.String("session_id", s.SessionID), zap.String("kind", string(s.Kind)), zap.String("reason", reason))
	if s.Kind == domain.RealtimeKindLive {
		ctx, cancel := context.WithTimeout(context.Background(), s.manager.timing.CallTimeout)
		err := l.conn.Write(ctx, websocket.MessageText, []byte(`{"type":"session.close"}`))
		cancel()
		if err == nil && s.awaitClose(l, s.manager.timing.CloseWait) {
			return reason
		}
		s.hangup()
		return reason
	}
	s.hangup()
	s.awaitClose(l, s.manager.timing.HangupSettle)
	return reason
}

// awaitClose keeps reading until the vendor closes the session or the wait
// runs out, so usage that arrives while the call winds down is recorded.
func (s *session) awaitClose(l *link, wait time.Duration) bool {
	timer := time.NewTimer(wait)
	defer timer.Stop()
	for {
		select {
		case event := <-l.events:
			if s.record(event) {
				return true
			}
		case err := <-l.lost:
			return s.drainEvents(l) || websocket.CloseStatus(err) != -1
		case <-timer.C:
			return false
		}
	}
}

func (s *session) hangup() {
	ctx, cancel := context.WithTimeout(context.Background(), s.manager.timing.CallTimeout)
	defer cancel()
	if err := s.manager.vendor.Hangup(ctx, s.BrokeredVoiceSession); err != nil {
		s.manager.logger.Warn("voice_session_hangup_failed",
			zap.String("session_id", s.SessionID), zap.Error(err))
	}
}

// finalize sends everything still waiting and closes the session record. A
// session the control plane already closed has nothing left to record.
func (s *session) finalize(reason string) {
	if reason == ReasonSessionClosed {
		return
	}
	// The vendor bills a Live session from creation, so one this gateway
	// never got to watch is charged that much and no less.
	if s.Kind == domain.RealtimeKindLive && !s.attached && s.meter.Seconds() == 0 {
		s.meter.Observe(liveCreationSeconds)
	}
	timing := s.manager.timing
	for attempt := 0; attempt < timing.FinalAttempts; attempt++ {
		if attempt > 0 {
			time.Sleep(timing.FinalBackoff)
		}
		if s.sendFinal() {
			return
		}
	}
	s.manager.logger.Error("voice_session_final_report_failed",
		zap.String("session_id", s.SessionID),
		zap.String("reason", reason),
		zap.Int("reports_unsent", len(s.queue)),
		zap.Float64("live_seconds", s.meter.Seconds()),
	)
}

// sendFinal sends the queue, then the close. The last duration delta of a
// Live session carries the close; any other session closes bare.
func (s *session) sendFinal() bool {
	closed, ok := s.sendQueued()
	if closed || !ok {
		return ok
	}
	if s.meter.Behind() {
		delta, _ := s.meter.Pending(time.Now(), 0, true)
		if _, err := s.send(s.report(delta)); err != nil {
			return false
		}
		s.meter.Ack()
	}
	if _, err := s.send(s.closingReport()); err != nil {
		return false
	}
	s.meter.Ack()
	return true
}

// sendQueued sends the queue in order. closed says the control plane had
// already closed the session, which leaves nothing more to send.
func (s *session) sendQueued() (closed, ok bool) {
	for len(s.queue) > 0 {
		receipt, err := s.send(s.queue[0])
		if err != nil {
			return false, false
		}
		s.queue = s.queue[1:]
		if receipt.Status == domain.RealtimeReportAlreadyClosed {
			return true, true
		}
	}
	return false, true
}

func (s *session) closingReport() domain.RealtimeUsageReport {
	closing := domain.RealtimeUsageReport{SessionID: s.SessionID, Source: domain.RealtimeMeteringGateway}
	if delta, hasDelta := s.meter.Pending(time.Now(), 0, true); hasDelta {
		closing = s.report(delta)
	} else if s.Bundle != nil {
		closing.ProjectID, closing.VirtualKeyID = s.Bundle.ProjectID, s.Bundle.VirtualKeyID
	}
	closing.Final = true
	closing.DurationMS = time.Since(s.StartedAt).Milliseconds()
	return closing
}
