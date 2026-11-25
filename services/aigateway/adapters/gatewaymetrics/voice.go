package gatewaymetrics

// SetVoiceSessions publishes how many brokered voice calls of one kind this
// pod supervises.
func (r *Recorder) SetVoiceSessions(kind string, count int) {
	if r == nil {
		return
	}
	r.voiceSessions.WithLabelValues(orUnknown(kind)).Set(float64(count))
}

// RecordVoiceSessionEnded counts one supervised call ending, by why.
func (r *Recorder) RecordVoiceSessionEnded(kind, reason string) {
	if r == nil {
		return
	}
	r.voiceEnded.WithLabelValues(orUnknown(kind), orUnknown(reason)).Inc()
}

// RecordVoiceUsageReport counts one usage report the supervisor sent, by
// what became of it.
func (r *Recorder) RecordVoiceUsageReport(outcome string) {
	if r == nil {
		return
	}
	r.voiceReports.WithLabelValues(orUnknown(outcome)).Inc()
}
