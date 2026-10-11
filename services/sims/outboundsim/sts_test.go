package outboundsim

import (
	"net/http"
	"strings"
	"testing"
)

var sigV4 = map[string]string{
	"Authorization": "AWS4-HMAC-SHA256 Credential=AKIASIM/20261009/us-east-1/sts/aws4_request, SignedHeaders=host, Signature=00",
	"Content-Type":  "application/x-www-form-urlencoded",
}

// @scenario "Outboundsim answers the STS AssumeRole calls managed Bedrock makes"
func TestSTSAssumeRoleHandsOutSessionCredentials(t *testing.T) {
	g := newRig(t, Config{})
	form := "Action=AssumeRole&Version=2011-06-15&RoleArn=arn%3Aaws%3Aiam%3A%3A123456789012%3Arole%2Fproxy&RoleSessionName=bedrock-test-python"
	first := g.do(http.MethodPost, "/sts/", sigV4, form)
	if first.status != http.StatusOK || !strings.Contains(first.body, "<SessionToken>sim-session-") ||
		!strings.Contains(first.body, "assumed-role/proxy/bedrock-test-python") {
		t.Fatalf("assume role = %d %s", first.status, first.body)
	}
	second := g.do(http.MethodPost, "/sts/", sigV4, form)
	if second.body == first.body {
		t.Fatal("each AssumeRole should hand out its own session credentials")
	}
	rec := g.records("channel=aws")
	if len(rec) != 2 || rec[0].Parsed["roleArn"] != "arn:aws:iam::123456789012:role/proxy" {
		t.Fatalf("records = %+v", rec)
	}
}

// @scenario "Outboundsim answers the STS AssumeRole calls managed Bedrock makes"
func TestSTSRefusesUnsignedAndDeniedRoles(t *testing.T) {
	g := newRig(t, Config{})
	denied := "Action=AssumeRole&RoleArn=arn%3Aaws%3Aiam%3A%3A1%3Arole%2Fdenied-customer&RoleSessionName=s"
	if got := g.do(http.MethodPost, "/sts/", sigV4, denied); got.status != http.StatusForbidden || !strings.Contains(got.body, "<Code>AccessDenied</Code>") {
		t.Fatalf("denied role = %d %s", got.status, got.body)
	}
	unsigned := map[string]string{"Content-Type": "application/x-www-form-urlencoded"}
	if got := g.do(http.MethodPost, "/sts/", unsigned, "Action=AssumeRole&RoleArn=a&RoleSessionName=s"); got.status != http.StatusForbidden ||
		!strings.Contains(got.body, "MissingAuthenticationToken") {
		t.Fatalf("unsigned = %d %s", got.status, got.body)
	}
	if got := g.do(http.MethodPost, "/sts/", sigV4, "Action=GetCallerIdentity"); got.status != http.StatusBadRequest {
		t.Fatalf("other action = %d, want 400", got.status)
	}
}
