package sources

import (
	"fmt"
	"net/url"
	"strings"
	"time"
)

// SimulatorItem is a caught message or identity tenant, without credentials.
type SimulatorItem struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Detail     string   `json:"detail"`
	Path       string   `json:"path"`
	Recipients []string `json:"recipients,omitempty"`
	Preview    []string `json:"-"`
}

// ReadSimulator reads a stack's own loopback listener, bypassing proxy DNS/TLS.
func ReadSimulator(port int, service string) ([]SimulatorItem, error) {
	api := newEndpoint(port)
	if service == "mail" {
		return readMail(api)
	}
	var body struct {
		Tenants []identitySummary `json:"tenants"`
	}
	if err := api.getJSON("/control/state", nil, &body); err != nil {
		return nil, err
	}
	out := make([]SimulatorItem, 0, len(body.Tenants))
	for _, tenant := range body.Tenants {
		preview := tenantPreview(tenant)
		out = append(out, SimulatorItem{
			Preview: preview,
			ID:      fmt.Sprint(tenant.ID), Title: fmt.Sprintf("Tenant %d · %s", tenant.ID, tenant.Domain),
			Detail: fmt.Sprintf("%d users · %d applications · OIDC / SAML / SCIM", len(tenant.Users), len(tenant.Applications)),
			Path:   fmt.Sprintf("/t/%d/", tenant.ID),
		})
	}
	return out, nil
}

func readMail(api endpoint) ([]SimulatorItem, error) {
	var body struct {
		Messages []struct {
			ID         string    `json:"id"`
			Subject    string    `json:"subject"`
			From       string    `json:"from"`
			To         []string  `json:"to"`
			ReceivedAt time.Time `json:"receivedAt"`
		} `json:"messages"`
	}
	if err := api.getJSON("/api/messages", nil, &body); err != nil {
		return nil, err
	}
	out := make([]SimulatorItem, 0, len(body.Messages))
	for _, message := range body.Messages {
		subject := message.Subject
		if subject == "" {
			subject = "(no subject)"
		}
		out = append(out, SimulatorItem{
			ID: message.ID, Title: message.ReceivedAt.Local().Format("15:04:05") + "  " + subject,
			Detail:     message.From + " → " + strings.Join(message.To, ", "),
			Recipients: message.To,
			Preview:    []string{"FROM", message.From, "", "TO", strings.Join(message.To, ", "), "", "RECEIVED", message.ReceivedAt.Local().Format(time.RFC3339)},
			Path:       "/messages/" + url.PathEscape(message.ID),
		})
	}
	return out, nil
}

// ReadMailDetail fetches only the selected message's plain text and links.
func ReadMailDetail(port int, id string) ([]string, error) {
	var body struct {
		Text  string   `json:"text"`
		Links []string `json:"links"`
	}
	if err := newEndpoint(port).getJSON("/api/messages/"+url.PathEscape(id), nil, &body); err != nil {
		return nil, err
	}
	if body.Text == "" {
		body.Text = "No plain-text body. Press o to view the sandboxed HTML preview in your browser."
	}
	lines := []string{"", "MESSAGE", body.Text}
	if len(body.Links) > 0 {
		lines = append(lines, "", "LINKS")
		lines = append(lines, body.Links...)
	}
	return lines, nil
}

type identitySummary struct {
	ID     int    `json:"id"`
	Domain string `json:"domain"`
	Users  []struct {
		Email  string `json:"email"`
		Active bool   `json:"active"`
	} `json:"users"`
	Applications []struct {
		Name         string   `json:"name"`
		ClientID     string   `json:"clientId"`
		RedirectURIs []string `json:"redirectUris"`
	} `json:"applications"`
}

func tenantPreview(tenant identitySummary) []string {
	preview := []string{"DOMAIN", tenant.Domain, "", "PROTOCOLS", "OIDC · SAML · SCIM", "", "USERS"}
	for _, user := range tenant.Users {
		state := "inactive"
		if user.Active {
			state = "active"
		}
		preview = append(preview, user.Email+" · "+state)
	}
	preview = append(preview, "", "APPLICATIONS")
	if len(tenant.Applications) == 0 {
		preview = append(preview, "No applications registered. Press o to register one in the browser.")
	}
	for _, app := range tenant.Applications {
		preview = append(preview, app.Name+" · "+app.ClientID)
		preview = append(preview, app.RedirectURIs...)
	}
	return preview
}
