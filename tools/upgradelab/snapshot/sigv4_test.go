package snapshot

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"
)

// TestSigV4MatchesAWSTestVectors checks get-vanilla and post-vanilla from AWS's published SigV4 suite.
func TestSigV4MatchesAWSTestVectors(t *testing.T) {
	signer := sigV4{credentials: Credentials{AccessKeyID: "AKIDEXAMPLE", SecretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY"}, region: "us-east-1", service: "service"}
	when := time.Date(2015, 8, 30, 12, 36, 0, 0, time.UTC)
	vectors := []struct{ method, signature string }{
		{http.MethodGet, "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"},
		{http.MethodPost, "5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b"},
	}
	for _, vector := range vectors {
		request, err := http.NewRequestWithContext(context.Background(), vector.method, "https://example.amazonaws.com/", nil)
		if err != nil {
			t.Fatal(err)
		}
		err = signer.sign(request, when)
		if err != nil {
			t.Fatal(err)
		}
		want := "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=" + vector.signature
		if got := request.Header.Get("Authorization"); got != want {
			t.Errorf("%s-vanilla:\n got %s\nwant %s", vector.method, got, want)
		}
	}
}

func TestSigV4RefusesToSignWithoutASecret(t *testing.T) {
	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, "https://example.amazonaws.com/", nil)
	if err != nil {
		t.Fatal(err)
	}
	err = sigV4{credentials: Credentials{AccessKeyID: "AKIDEXAMPLE"}, region: "us-east-1", service: "s3"}.sign(request, time.Now())
	if !errors.Is(err, errNoCredentials) || request.Header.Get("Authorization") != "" {
		t.Fatalf("signing without a secret: err %v, authorization set %t", err, request.Header.Get("Authorization") != "")
	}
}

func TestAWSEscapeKeepsUnreservedAndPathSlashes(t *testing.T) {
	if got := awsEscape("/a b/ü+~.txt", false); got != "/a%20b/%C3%BC%2B~.txt" {
		t.Fatalf("path escape = %s", got)
	}
	if got := awsEscape("next+/=2", true); got != "next%2B%2F%3D2" {
		t.Fatalf("query escape = %s", got)
	}
}
