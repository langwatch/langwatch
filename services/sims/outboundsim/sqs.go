package outboundsim

import (
	"crypto/md5" // #nosec G501 -- SQS defines MD5OfMessageBody; not a security use
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

const (
	sqsTargetPrefix = "AmazonSQS."
	awsJSONType     = "application/x-amz-json-1.0"
)

// sqsInput is the part of an AWS JSON 1.0 SendMessage body outboundsim reads.
type sqsInput struct {
	QueueURL          string `json:"QueueUrl"`
	MessageBody       string `json:"MessageBody"`
	MessageAttributes any    `json:"MessageAttributes"`
	MessageGroupID    string `json:"MessageGroupId"`
}

func sqsError(code, message string) reply {
	out := jsonReply(http.StatusBadRequest, map[string]string{"__type": code, "message": message})
	out.contentType = awsJSONType
	out.header = map[string]string{"x-amzn-ErrorType": code}
	return out
}

func (s *Server) handleSQS(w http.ResponseWriter, r *http.Request) {
	c, ok := readCall(w, r, ChannelSQS, r.URL.Path)
	if !ok {
		return
	}
	action, isJSON := strings.CutPrefix(r.Header.Get("X-Amz-Target"), sqsTargetPrefix)
	if !isJSON {
		s.sqsQuery(w, c)
		return
	}
	c.parsed = map[string]any{"action": action}
	var in sqsInput
	if err := json.Unmarshal(c.body, &in); err != nil {
		s.finish(w, c, sqsError("SerializationException", "the body is not JSON"))
		return
	}
	if in.QueueURL != "" {
		c.target = in.QueueURL
	}
	s.finish(w, c, s.sqsSend(&c, action, in))
}

// sqsSend answers an AWS JSON action; only SendMessage is spoken.
func (s *Server) sqsSend(c *call, action string, in sqsInput) reply {
	if action != "SendMessage" {
		return sqsError("UnsupportedOperation", "outboundsim speaks SendMessage only, not "+action)
	}
	c.parsed["queueUrl"] = in.QueueURL
	if in.MessageAttributes != nil {
		c.parsed["messageAttributes"] = in.MessageAttributes
	}
	if in.MessageGroupID != "" {
		c.parsed["messageGroupId"] = in.MessageGroupID
	}
	if in.MessageBody == "" {
		return sqsError("InvalidParameterValue", "MessageBody must not be empty")
	}
	sum := md5.Sum([]byte(in.MessageBody)) // #nosec G401 -- see import
	out := jsonReply(http.StatusOK, map[string]string{"MD5OfMessageBody": hex.EncodeToString(sum[:]), "MessageId": newMessageID()})
	out.contentType = awsJSONType
	return out
}

// sqsQuery refuses the query protocol, and a post that is not SQS at all.
func (s *Server) sqsQuery(w http.ResponseWriter, c call) {
	form, err := url.ParseQuery(string(c.body))
	if action := form.Get("Action"); err == nil && action != "" {
		c.parsed = map[string]any{"action": action}
		s.finish(w, c, sqsError("InvalidAction", "outboundsim speaks AWS JSON 1.0, not the query protocol"))
		return
	}
	writeError(w, http.StatusNotFound, "outboundsim does not fake POST "+c.target)
}

func newMessageID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
