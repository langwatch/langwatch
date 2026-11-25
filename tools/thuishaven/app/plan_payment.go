package app

import (
	"fmt"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// paymentEnv is paymentsim's own configuration: its port, the billing catalog it
// seeds and the app's Stripe webhook door it signs deliveries to.
func paymentEnv(st domain.Stack, repoRoot string) []string {
	var port int
	var self, app string
	for _, svc := range st.Services {
		switch svc.Name {
		case domain.PaymentService:
			port, self = svc.Port, svc.URL
		case "app":
			app = svc.URL
		}
	}
	env := []string{
		fmt.Sprintf("PAYMENTSIM_ADDR=:%d", port), "PAYMENTSIM_STACK=" + st.Slug, "PAYMENTSIM_PUBLIC_URL=" + self,
		"PAYMENTSIM_WEBHOOK_SECRET=" + domain.PaymentSimWebhookSecret,
		"PAYMENTSIM_CATALOG=" + filepath.Join(repoRoot, "enterprise", "modules", "billing", "contract", "src", "stripe-catalog.json"),
	}
	if app != "" {
		env = append(env, "PAYMENTSIM_WEBHOOK_URL="+app+"/api/webhooks/stripe")
	}
	return env
}

// paymentChild is the supervised paymentsim lane. It keeps nothing on disk.
func (o *Orchestrator) paymentChild(st domain.Stack, repoRoot string, base []string) Child {
	logDir, _ := domain.StackLogPaths(st.WorktreeDir, st.Slug)
	return Child{
		Name: domain.PaymentService, Dir: repoRoot, Color: palette[2], LogPath: filepath.Join(logDir, domain.PaymentService+".log"),
		Shell: o.simulatorShell("payment"),
		Env:   append(append(append([]string{}, base...), domain.LaneEnv(domain.PaymentService)), paymentEnv(st, repoRoot)...),
	}
}
