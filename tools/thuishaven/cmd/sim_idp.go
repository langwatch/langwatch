package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// `haven idp <verb>` drives idpsim's control API, the same actions its console
// offers. Bare `haven idp` still runs the standalone simulator (see runIdP).

// idpFlags are the idp noun's own flags; table.go adds --json and --stack.
var idpFlags = []flagSpec{
	{long: "--tenants", takesValue: true, value: "<n>", summary: "bare run: tenant range size (default 3)"},
	{long: "--name", takesValue: true, value: "<name>", summary: "apps add: the application's name"},
	{long: "--redirect", takesValue: true, value: "<uri,...>", summary: "apps add / signin: redirect URIs, comma separated"},
	{long: "--entity-id", takesValue: true, value: "<id>", summary: "apps add, saml unsolicited: SAML entity id"},
	{long: "--acs-url", takesValue: true, value: "<url>", summary: "apps add, saml unsolicited: SAML assertion consumer URL"},
	{long: "--relay-state", takesValue: true, value: "<s>", summary: "saml unsolicited: the RelayState to post"},
	{long: "--users", takesValue: true, value: "<n>", summary: "populate: total users"},
	{long: "--groups", takesValue: true, value: "<n|a,b>", summary: "populate: group count; user add: group ids"},
	{long: "--domain", takesValue: true, value: "<domain>", summary: "populate: email domain override"},
	{long: "--seed", takesValue: true, value: "<n>", summary: "populate: reproducible seed"},
	{long: "--join", takesValue: true, value: "<n>", summary: "churn: people joining"},
	{long: "--leave", takesValue: true, value: "<n>", summary: "churn: people removed"},
	{long: "--deactivate", takesValue: true, value: "<n>", summary: "churn: people deactivated"},
	{long: "--reactivate", takesValue: true, value: "<n>", summary: "churn: people reactivated"},
	{long: "--rename", takesValue: true, value: "<n>", summary: "churn: people renamed"},
	{long: "--regroup", takesValue: true, value: "<n>", summary: "churn: people moved group"},
	{long: "--email", takesValue: true, value: "<email>", summary: "user add, saml unsolicited: the address"},
	{long: "--given-name", takesValue: true, value: "<name>", summary: "user add: given name"},
	{long: "--family-name", takesValue: true, value: "<name>", summary: "user add: family name"},
	{long: "--url", takesValue: true, value: "<url>", summary: "scim target set: the SCIM base URL"},
	{long: "--target", takesValue: true, value: "<url>", summary: "scim push|pull|sync|event, auth0-webhook: the receiving side"},
	{long: "--token-env", takesValue: true, value: "<VAR>", summary: "SCIM bearer token, read from this environment variable"},
	{long: "--secret-env", takesValue: true, value: "<VAR>", summary: "auth0-webhook: signing secret, read from this environment variable"},
	{long: "--mode", takesValue: true, value: "<deactivate|delete>", summary: "scim sync: what a departure means"},
	{long: "--with-groups", summary: "scim sync: reconcile groups too"},
	{long: "--drop-previous", summary: "rotate-key: stop publishing the previous signing key instead of rotating"},
	{long: "--dry-run", summary: "scim sync: report the difference, send nothing"},
	{long: "--concurrency", takesValue: true, value: "<n>", summary: "scim sync: requests in flight"},
	{long: "--client", takesValue: true, value: "<client-id>", summary: "signin: the relying party's client id"},
	{long: "--event", takesValue: true, value: "<create|deactivate>", summary: "auth0-webhook: the event"},
	{long: "--user", takesValue: true, value: "<user>", summary: "signin, auth0-webhook, scim-event: a user's id, email or userName"},
	{long: "--group", takesValue: true, value: "<group>", summary: "scim-event: a group's id or name"},
	{long: "--style", takesValue: true, value: "<okta|entra>", summary: "scim-event: the PATCH spelling"},
	{long: "--set", takesValue: true, value: "<k=v>", summary: "scim-event: an attribute to set; repeatable"},
	{long: "--id", takesValue: true, value: "<id>", summary: "scim-event: the receiving side's id for the target"},
	{long: "--member-id", takesValue: true, value: "<id>", summary: "scim-event: the receiving side's id for the member"},
	{long: "--inactive", summary: "scim-event: create the user inactive"},
	{long: "--no-external-id", summary: "scim-event: create the user without an external id"},
	{long: "--department", takesValue: true, value: "<text>", summary: "scim-event: enterprise extension department"},
	{long: "--cost-center", takesValue: true, value: "<text>", summary: "scim-event: enterprise extension cost center"},
	{long: "--manager", takesValue: true, value: "<text>", summary: "scim-event: enterprise extension manager"},
}

// idpCall is one verb's input: the sim, the flags, and the arguments after the verb words.
type idpCall struct {
	api    sources.SimAPI
	inv    invocation
	rest   []string
	asJSON bool
}

// idpVerb is one `haven idp` action. min counts the arguments after the words.
type idpVerb struct {
	usage string
	min   int
	run   func(idpCall) error
}

const idpAppsAddUsage = "<tenant> --name <n> [--redirect <uri,...>] [--entity-id <id> --acs-url <url>]"

// idpVerbs maps a verb's words to its action.
var idpVerbs = map[string]idpVerb{
	"tenant show":       {"<tenant>", 1, idpTenantShow},
	"apps add":          {idpAppsAddUsage, 1, idpAppsAdd},
	"apps remove":       {"<tenant> <client-id>", 2, idpAppsRemove},
	"populate":          {"<tenant> --users <n> [--groups <n>] [--domain <d>] [--seed <n>]", 1, idpPopulate},
	"churn":             {"<tenant> [--join|--leave|--deactivate|--reactivate|--rename|--regroup <n>]", 1, idpChurn},
	"user add":          {"<tenant> --email <e> [--given-name <n>] [--family-name <n>] [--groups <id,...>]", 1, idpUserAdd},
	"dns add":           {"<domain> <txt-value>...", 2, idpDNSAdd},
	"dns remove":        {"<domain>", 1, idpDNSRemove},
	"activity":          {"<tenant>", 1, idpActivity},
	"signin":            {"<tenant> [--user <u>] [--client <id> --redirect <uri>]", 1, idpSignIn},
	"reset":             {"<tenant>", 1, idpReset},
	"samlp":             {"<tenant> <on|off>", 2, idpSamlp},
	"scim target set":   {"<tenant> --url <scim-base> --token-env <VAR>", 1, idpSCIMTargetSet},
	"scim target clear": {"<tenant>", 1, idpSCIMTargetClear},
	"scim push":         {"<tenant> [--target <url> --token-env <VAR>]", 1, idpSCIMPush},
	"scim pull":         {"<tenant> [--target <url> --token-env <VAR>]", 1, idpSCIMPull},
	"scim sync":         {"<tenant> [--mode deactivate|delete] [--with-groups] [--dry-run] [--concurrency <n>] [--target <url> --token-env <VAR>]", 1, idpSCIMSync},
	"scim-event":        {"<tenant> <kind> [--style okta|entra] [--user <u>] [--group <g>] [--set k=v]... [--id <id>] [--member-id <id>] [--inactive] [--no-external-id] [--department|--cost-center|--manager <text>] [--target <url> --token-env <VAR>]", 2, idpSCIMEvent},
	"legacy provider":   {"<tenant> <generic|auth0|okta|cognito|onelogin|azure|show>", 2, idpLegacyProvider},
	"legacy env":        {"<tenant>", 1, idpLegacyEnv},
	"tamper":            {"<tenant> <bad-signature|wrong-audience|expired|replayed-nonce|saml-bad-signature|saml-unsigned|saml-wrong-audience|saml-wrong-recipient|saml-expired|saml-not-yet-valid|saml-replayed-assertion|saml-wrong-in-response-to|none>", 2, idpTamper},
	"skew":              {"<tenant> <seconds>", 2, idpSkew},
	"rotate-key":        {"<tenant> [--drop-previous]", 1, idpRotateKey},
	"user disable":      {"<tenant> <email>", 2, idpUserDisable},
	"user enable":       {"<tenant> <email>", 2, idpUserEnable},
	"saml unsolicited":  {"<tenant> --acs-url <url> --email <e> [--entity-id <id>] [--relay-state <s>]", 1, idpSAMLUnsolicited},
	"auth0-webhook":     {"<tenant> --event create|deactivate --user <u> --target <stack-url> --secret-env <VAR> [--token-env <VAR>]", 1, idpAuth0Webhook},
}

// runIdP is `haven idp`: a verb drives a running idpsim, no verb runs the standalone one.
func runIdP(ctx context.Context, d deps, inv invocation) error {
	if len(inv.args) > 0 {
		return runIdPVerb(d, inv)
	}
	if inv.has("--json") {
		return printSimulator(d, inv, "idp")
	}
	if inv.value("--stack") != "" {
		return fmt.Errorf("--stack requires --json")
	}
	tenants := 0
	if raw := inv.value("--tenants"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return fmt.Errorf("--tenants needs a positive integer, got %q", raw)
		}
		tenants = n
	}
	return d.orch.RunIdPSolo(ctx, tenants)
}

func runIdPVerb(d deps, inv invocation) error {
	verb, words, rest, ok := findIdPVerb(inv.args)
	if !ok {
		return fmt.Errorf("unknown `haven idp` verb %q\n%s", strings.Join(inv.args, " "), idpUsage())
	}
	if len(rest) < verb.min {
		return fmt.Errorf("usage: haven idp %s %s", words, verb.usage)
	}
	api, err := simAPI(d, inv, "idp")
	if err != nil {
		return err
	}
	return verb.run(idpCall{api: api, inv: inv, rest: rest, asJSON: inv.has("--json") || d.isAgent})
}

// findIdPVerb matches the longest run of leading words that names a verb.
func findIdPVerb(args []string) (idpVerb, string, []string, bool) {
	for n := min(3, len(args)); n >= 1; n-- {
		words := strings.Join(args[:n], " ")
		if verb, ok := idpVerbs[words]; ok {
			return verb, words, args[n:], true
		}
	}
	return idpVerb{}, "", nil, false
}

func idpUsage() string {
	lines := make([]string, 0, len(idpVerbs))
	for words, verb := range idpVerbs {
		lines = append(lines, "  haven idp "+words+" "+verb.usage)
	}
	sort.Strings(lines)
	return "usage:\n" + strings.Join(lines, "\n")
}

// tenant is the control path of the tenant named first, "/control/t/<n>".
func (c idpCall) tenant() (string, error) {
	n, err := strconv.Atoi(c.rest[0])
	if err != nil || n < 1 {
		return "", fmt.Errorf("%q is not a tenant number (1, 2, ...)", c.rest[0])
	}
	return strconv.Itoa(n), nil
}

// show prints the sim's answer; a mutation with no body says it is done.
func (c idpCall) show(raw json.RawMessage) error {
	if len(raw) == 0 {
		return simDone(c.asJSON, "done", "done")
	}
	return printSimRaw(raw)
}

func (c idpCall) post(path string, body any) error {
	var raw json.RawMessage
	if err := c.api.Post(path, body, &raw); err != nil {
		return err
	}
	return c.show(raw)
}

func (c idpCall) put(path string, body any) error {
	var raw json.RawMessage
	if err := c.api.Put(path, body, &raw); err != nil {
		return err
	}
	return c.show(raw)
}

// postTenant posts body to /control/t/<n>/<leaf>.
func (c idpCall) postTenant(leaf string, body any) error {
	t, err := c.tenant()
	if err != nil {
		return err
	}
	return c.post("/control/t/"+t+"/"+leaf, body)
}

// numbers collects the integer flags given, keyed by the flag's name without dashes.
func numbers(inv invocation, flags ...string) (map[string]any, error) {
	out := map[string]any{}
	for _, flag := range flags {
		if !inv.has(flag) {
			continue
		}
		n, err := strconv.Atoi(inv.value(flag))
		if err != nil {
			return nil, fmt.Errorf("%s needs a whole number, got %q", flag, inv.value(flag))
		}
		out[strings.TrimPrefix(flag, "--")] = n
	}
	return out, nil
}

func splitList(raw string) []string {
	var out []string
	for _, part := range strings.Split(raw, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}

// envSecret reads the secret named by envFlag from this process's environment.
// The value is never a flag, never printed and never part of an error.
func envSecret(inv invocation, envFlag string) (string, error) {
	name := inv.value(envFlag)
	if name == "" {
		return "", nil
	}
	value := os.Getenv(name)
	if value == "" {
		return "", fmt.Errorf("%s names %s, which is not set in this environment", envFlag, name)
	}
	return value, nil
}

func idpTenantShow(c idpCall) error {
	t, err := c.tenant()
	if err != nil {
		return err
	}
	return simGet(c.api, "/api/t/"+t, nil, c.asJSON, func(v struct {
		Domain, BaseURL, SCIMToken string
		Users                      []struct{ Email string }
		Applications               []struct{ Name, ClientID string }
	}) {
		fmt.Printf("tenant %s\ndomain: %s\nissuer: %s\nscim token: %s\nusers: %d\n", t, v.Domain, v.BaseURL, v.SCIMToken, len(v.Users))
		for _, a := range v.Applications {
			fmt.Printf("app: %s (%s)\n", a.Name, a.ClientID)
		}
	})
}

func idpAppsAdd(c idpCall) error {
	if !c.inv.has("--name") {
		return errors.New("usage: haven idp apps add " + idpAppsAddUsage)
	}
	return c.postTenant("apps", map[string]any{
		"name": c.inv.value("--name"), "redirectUris": splitList(c.inv.value("--redirect")),
		"entityId": c.inv.value("--entity-id"), "acsUrl": c.inv.value("--acs-url"),
	})
}

func idpAppsRemove(c idpCall) error {
	t, err := c.tenant()
	if err != nil {
		return err
	}
	if err := c.api.Delete("/api/t/" + t + "/apps/" + url.PathEscape(c.rest[1])); err != nil {
		return err
	}
	return simDone(c.asJSON, "removed", "application removed")
}

func idpPopulate(c idpCall) error {
	body, err := numbers(c.inv, "--users", "--groups", "--seed")
	if err != nil {
		return err
	}
	if !c.inv.has("--users") {
		return fmt.Errorf("usage: haven idp populate <tenant> --users <n> [--groups <n>] [--domain <d>] [--seed <n>]")
	}
	if c.inv.has("--domain") {
		body["domain"] = c.inv.value("--domain")
	}
	return c.postTenant("population", body)
}

func idpChurn(c idpCall) error {
	body, err := numbers(c.inv, "--join", "--leave", "--deactivate", "--reactivate", "--rename", "--regroup")
	if err != nil {
		return err
	}
	return c.postTenant("churn", body)
}

func idpUserAdd(c idpCall) error {
	if !c.inv.has("--email") {
		return fmt.Errorf("usage: haven idp user add <tenant> --email <e> [--given-name <n>] [--family-name <n>] [--groups <id,...>]")
	}
	return c.postTenant("users", map[string]any{
		"email": c.inv.value("--email"), "givenName": c.inv.value("--given-name"),
		"familyName": c.inv.value("--family-name"), "groups": splitList(c.inv.value("--groups")),
	})
}

// idpDNSAdd publishes a TXT record; the DNS table is global to idpsim, not per tenant.
func idpDNSAdd(c idpCall) error {
	return c.put("/control/dns/txt", map[string]any{"domain": c.rest[0], "values": c.rest[1:]})
}

// idpDNSRemove sends no values, which idpsim reads as "remove".
func idpDNSRemove(c idpCall) error {
	return c.put("/control/dns/txt", map[string]any{"domain": c.rest[0]})
}

func idpActivity(c idpCall) error {
	t, err := c.tenant()
	if err != nil {
		return err
	}
	return simGet(c.api, "/control/t/"+t+"/activity", nil, c.asJSON, func(v struct {
		Events []struct{ At, Kind, Outcome, Subject, Detail string }
	}) {
		if len(v.Events) == 0 {
			fmt.Println("no activity yet")
		}
		for _, e := range v.Events {
			fmt.Printf("%s %-16s %-8s %-24s %s\n", e.At, e.Kind, e.Outcome, e.Subject, e.Detail)
		}
	})
}

func idpReset(c idpCall) error { return c.postTenant("reset", nil) }

func idpSamlp(c idpCall) error {
	if c.rest[1] != "on" && c.rest[1] != "off" {
		return fmt.Errorf("usage: haven idp samlp <tenant> <on|off>")
	}
	return c.postTenant("config", map[string]bool{"samlpSubjects": c.rest[1] == "on"})
}

// idpSignIn prints the IdP-initiated sign-in URL for one user, or for everyone who can sign in.
func idpSignIn(c idpCall) error {
	t, err := c.tenant()
	if err != nil {
		return err
	}
	var tenant struct{ RootURL string }
	if err := c.api.Get("/api/t/"+t, nil, &tenant); err != nil {
		return err
	}
	params := url.Values{}
	for flag, key := range map[string]string{"--client": "client_id", "--redirect": "redirect_uri"} {
		if c.inv.has(flag) {
			params.Set(key, c.inv.value(flag))
		}
	}
	return simGet(c.api, "/api/t/"+t+"/sign-in", params, c.asJSON, func(v signInReply) {
		printSignIn(v, tenant.RootURL, c.inv.value("--user"))
	})
}

type signInReply struct {
	Refusal *struct{ Title, Detail, Hint string }
	Users   []struct{ Name, Email, Href string }
}

func printSignIn(v signInReply, root, only string) {
	if v.Refusal != nil {
		fmt.Printf("refused: %s. %s %s\n", v.Refusal.Title, v.Refusal.Detail, v.Refusal.Hint)
		return
	}
	for _, u := range v.Users {
		if only == "" || strings.EqualFold(only, u.Email) {
			fmt.Printf("%s <%s>\n  %s%s\n", u.Name, u.Email, root, u.Href)
		}
	}
}
