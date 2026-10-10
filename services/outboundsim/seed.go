package outboundsim

import (
	"net/http"
	"time"
)

// seedQueueURL is the SQS queue the setup page tells a developer to paste.
const seedQueueURL = "https://sqs.eu-west-1.amazonaws.com/000000000000/outboundsim"

// seedSlowDelay is how long the seeded "slow" receiver holds its answer.
const seedSlowDelay = 15 * time.Second

func seedWorkspace() *slackWorkspace {
	return &slackWorkspace{
		team: "outboundsim", teamID: "T0SIM", user: "outboundsim", userID: "U0SIM",
		channels: []slackChannel{
			{ID: "C0GENERAL", Name: "general", IsChannel: true, IsMember: true},
			{ID: "C0ALERTS", Name: "alerts", IsChannel: true, IsMember: true},
			{ID: "C0BUGS", Name: "bug-reports", IsChannel: true, IsMember: true},
			{ID: "C0OLD", Name: "old-archive", IsChannel: true, IsMember: true, IsArchived: true},
		},
	}
}

func seedReceivers() *receiverSet {
	rs := &receiverSet{byName: map[string]*receiver{}, attempts: map[string]int{}, slowDelay: seedSlowDelay}
	for _, mode := range []string{modeOK, modeFlaky, modeSlow, modeGone, modeRedirect} {
		rs.byName[mode] = &receiver{mode: mode, seeded: true}
	}
	return rs
}

// seedRecords is the sample content loaded when OUTBOUNDSIM_SEED=1.
func seedRecords() []Record {
	return []Record{
		{
			Channel: ChannelSlackWebhook, Target: "/services/T0SIM/B0SIGNUPS/x", Method: http.MethodPost, Status: http.StatusOK,
			Body: `{"text":"New sign-up: demo@example.com"}`, Parsed: map[string]any{"text": "New sign-up: demo@example.com"}, seeded: true,
		},
		{
			Channel: ChannelWebhook, Target: "ok", Method: http.MethodPost, Status: http.StatusOK, EventID: "evt_demo_1",
			Signature: SignatureUnchecked, Body: `{"type":"trace.created"}`,
			Parsed: map[string]any{"eventId": "evt_demo_1", "attempt": 1}, seeded: true,
		},
		{
			Channel: ChannelSQS, Target: seedQueueURL, Method: http.MethodPost, Status: http.StatusOK,
			Body:   `{"QueueUrl":"` + seedQueueURL + `","MessageBody":"hello"}`,
			Parsed: map[string]any{"action": "SendMessage", "queueUrl": seedQueueURL}, seeded: true,
		},
	}
}
