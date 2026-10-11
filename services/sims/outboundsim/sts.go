package outboundsim

import (
	"encoding/xml"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"
)

// ChannelAWS records the AWS STS calls managed Bedrock makes when its STS base points here.
const ChannelAWS = "aws"

// stsSerial numbers the session credentials AssumeRole hands out, so each hop's are distinct.
var stsSerial atomic.Int64

type stsCredentials struct {
	AccessKeyID     string `xml:"AccessKeyId"`
	SecretAccessKey string `xml:"SecretAccessKey"`
	SessionToken    string `xml:"SessionToken"`
	Expiration      string `xml:"Expiration"`
}

type stsAssumeRoleResponse struct {
	XMLName xml.Name `xml:"https://sts.amazonaws.com/doc/2011-06-15/ AssumeRoleResponse"`
	Result  struct {
		Credentials     stsCredentials `xml:"Credentials"`
		AssumedRoleUser struct {
			AssumedRoleID string `xml:"AssumedRoleId"`
			Arn           string `xml:"Arn"`
		} `xml:"AssumedRoleUser"`
	} `xml:"AssumeRoleResult"`
	RequestID string `xml:"ResponseMetadata>RequestId"`
}

type stsErrorResponse struct {
	XMLName xml.Name `xml:"https://sts.amazonaws.com/doc/2011-06-15/ ErrorResponse"`
	Type    string   `xml:"Error>Type"`
	Code    string   `xml:"Error>Code"`
	Message string   `xml:"Error>Message"`
	ID      string   `xml:"RequestId"`
}

func xmlReply(status int, v any) reply {
	encoded, _ := xml.Marshal(v)
	return reply{status: status, contentType: "text/xml", body: xml.Header + string(encoded)}
}

func stsError(status int, code, message string) reply {
	return xmlReply(status, stsErrorResponse{Type: "Sender", Code: code, Message: message, ID: "sim-request"})
}

// handleSTS serves the AWS query protocol at POST /sts/: AssumeRole only. A call needs a SigV4
// Authorization header (never verified) and a RoleArn; a RoleArn holding "denied" is refused
// with AccessDenied, as a role whose trust policy does not name the caller is.
func (s *Server) handleSTS(w http.ResponseWriter, r *http.Request) {
	c, ok := readCall(w, r, ChannelAWS, r.URL.Path)
	if !ok {
		return
	}
	form, _ := url.ParseQuery(string(c.body))
	c.parsed = map[string]any{"action": form.Get("Action"), "roleArn": form.Get("RoleArn"), "roleSessionName": form.Get("RoleSessionName")}
	auth := r.Header.Get("Authorization")
	switch {
	case !strings.HasPrefix(auth, "AWS4-HMAC-SHA256 "):
		s.finish(w, c, stsError(http.StatusForbidden, "MissingAuthenticationToken", "Request is missing Authentication Token"))
	case form.Get("Action") != "AssumeRole":
		s.finish(w, c, stsError(http.StatusBadRequest, "InvalidAction", "outboundsim fakes AssumeRole only"))
	case form.Get("RoleArn") == "" || form.Get("RoleSessionName") == "":
		s.finish(w, c, stsError(http.StatusBadRequest, "MissingParameter", "RoleArn and RoleSessionName are required"))
	case strings.Contains(strings.ToLower(form.Get("RoleArn")), "denied"):
		s.finish(w, c, stsError(http.StatusForbidden, "AccessDenied",
			"User is not authorized to perform: sts:AssumeRole on resource: "+form.Get("RoleArn")))
	default:
		n := stsSerial.Add(1)
		var out stsAssumeRoleResponse
		out.Result.Credentials = stsCredentials{
			AccessKeyID: fmt.Sprintf("ASIASIM%013d", n), SecretAccessKey: fmt.Sprintf("sim-secret-%d", n),
			SessionToken: fmt.Sprintf("sim-session-%d", n), Expiration: s.now().UTC().Add(time.Hour).Format(time.RFC3339),
		}
		out.Result.AssumedRoleUser.AssumedRoleID = "AROASIM:" + form.Get("RoleSessionName")
		out.Result.AssumedRoleUser.Arn = assumedRoleArn(form.Get("RoleArn"), form.Get("RoleSessionName"))
		out.RequestID = fmt.Sprintf("sim-request-%d", n)
		s.finish(w, c, xmlReply(http.StatusOK, out))
	}
}

// assumedRoleArn is the session ARN STS names for a role ARN of the arn:aws:iam::<acct>:role/<name> shape.
func assumedRoleArn(roleArn, session string) string {
	account, role := "000000000000", roleArn
	if parts := strings.SplitN(roleArn, ":", 6); len(parts) == 6 {
		account, role = parts[4], strings.TrimPrefix(parts[5], "role/")
	}
	return "arn:aws:sts::" + account + ":assumed-role/" + role + "/" + session
}
