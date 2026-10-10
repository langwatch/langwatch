package lambdasim

import (
	"bytes"
	"cmp"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// lwaSeparator ends the Lambda Web Adapter's RESPONSE_STREAM prelude.
var lwaSeparator = make([]byte, 8)

// functionURLEvent is the Lambda function URL event the workflow module sends,
// the shape the image's Lambda Web Adapter turns back into an HTTP request.
type functionURLEvent struct {
	RawPath         string            `json:"rawPath"`
	RawQueryString  string            `json:"rawQueryString"`
	Headers         map[string]string `json:"headers"`
	Body            string            `json:"body"`
	IsBase64Encoded bool              `json:"isBase64Encoded"`
	RequestContext  struct {
		HTTP struct {
			Method string `json:"method"`
		} `json:"http"`
	} `json:"requestContext"`
}

// invocation is one invoke's bookkeeping, filled as it runs and recorded at the end.
type invocation struct {
	rec     call
	started time.Time
	resBody bytes.Buffer
}

// begin reads the event, applies a forced error and resolves the function. A nil
// result means the response is already written.
func (s *Server) begin(w http.ResponseWriter, r *http.Request, mode string) (*invocation, *functionURLEvent) {
	inv := &invocation{started: time.Now(), rec: call{At: time.Now().UTC(), Mode: mode, Function: functionName(r.PathValue("name"))}}
	payload, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 6<<20))
	if err != nil {
		s.finish(inv, http.StatusRequestEntityTooLarge, "RequestTooLargeException")
		writeAWSError(w, http.StatusRequestEntityTooLarge, "RequestTooLargeException", "Request must be smaller than 6291456 bytes for the InvokeFunction operation")
		return nil, nil
	}
	inv.rec.Request = keep(payload, s.cfg.MaxBodyBytes)
	var event functionURLEvent
	if err := json.Unmarshal(payload, &event); err != nil || event.RawPath == "" {
		s.finish(inv, http.StatusBadRequest, "not a function URL event")
		writeAWSError(w, http.StatusBadRequest, "InvalidRequestContentException", "lambdasim runs function URL events (rawPath, requestContext.http.method) only")
		return nil, nil
	}
	inv.rec.Method, inv.rec.Path = cmp.Or(event.RequestContext.HTTP.Method, http.MethodGet), event.RawPath

	switch s.settings().ForcedError {
	case ErrorThrottled:
		s.finish(inv, http.StatusTooManyRequests, "forced TooManyRequestsException")
		writeAWSError(w, http.StatusTooManyRequests, "TooManyRequestsException", "Rate Exceeded.")
		return nil, nil
	case ErrorNotFound:
		s.finish(inv, http.StatusNotFound, "forced ResourceNotFoundException")
		notFound(w, inv.rec.Function)
		return nil, nil
	case ErrorService:
		s.finish(inv, http.StatusInternalServerError, "forced ServiceException")
		writeAWSError(w, http.StatusInternalServerError, "ServiceException", "lambdasim forced a service error")
		return nil, nil
	}

	s.mu.Lock()
	fn := s.functions[inv.rec.Function]
	if fn == nil {
		// A cached ARN can outlive lambdasim's memory; running it beats a 404 nobody can clear.
		fn = newFunction(inv.rec.Function)
		s.functions[fn.FunctionName] = fn
	}
	fn.lastInvoked = time.Now()
	s.mu.Unlock()
	return inv, &event
}

// forward runs the event on nlpgo, as the Lambda Web Adapter would.
func (s *Server) forward(r *http.Request, event *functionURLEvent) (*http.Response, error) {
	body := []byte(event.Body)
	if event.IsBase64Encoded {
		decoded, err := base64.StdEncoding.DecodeString(event.Body)
		if err != nil {
			return nil, fmt.Errorf("the event body is not base64: %w", err)
		}
		body = decoded
	}
	target := s.cfg.Target + event.RawPath
	if event.RawQueryString != "" {
		target += "?" + event.RawQueryString
	}
	req, err := http.NewRequestWithContext(r.Context(), cmp.Or(event.RequestContext.HTTP.Method, http.MethodGet), target, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	for k, v := range event.Headers {
		req.Header.Set(k, v)
	}
	return s.client.Do(req)
}

// prelude is the adapter's JSON head naming nlpgo's status and headers, then its separator.
func prelude(res *http.Response) []byte {
	headers := map[string]string{}
	for k := range res.Header {
		headers[strings.ToLower(k)] = res.Header.Get(k)
	}
	head, _ := json.Marshal(map[string]any{"statusCode": res.StatusCode, "headers": headers, "cookies": []string{}})
	return append(head, lwaSeparator...)
}

// handleInvoke is a synchronous Invoke: nlpgo's whole answer in one payload.
func (s *Server) handleInvoke(w http.ResponseWriter, r *http.Request) {
	inv, event := s.begin(w, r, "invoke")
	if inv == nil {
		return
	}
	w.Header().Set("X-Amz-Executed-Version", "$LATEST")
	if s.settings().ForcedError == ErrorFunctionError {
		s.functionError(w, inv, errors.New("lambdasim forced a function error"))
		return
	}
	res, err := s.forward(r, event)
	if err != nil {
		s.functionError(w, inv, err)
		return
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		s.functionError(w, inv, err)
		return
	}
	inv.resBody.Write(body)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(append(prelude(res), body...))
	s.finish(inv, res.StatusCode, "")
}

// functionError is what Lambda answers when the handler fails: 200, with the error named in a header.
func (s *Server) functionError(w http.ResponseWriter, inv *invocation, cause error) {
	inv.rec.FunctionError = "Unhandled"
	w.Header().Set("X-Amz-Function-Error", "Unhandled")
	payload, _ := json.Marshal(map[string]string{"errorType": "Runtime.Unhandled", "errorMessage": cause.Error()})
	inv.resBody.Write(payload)
	writeJSON(w, http.StatusOK, json.RawMessage(payload))
	s.finish(inv, 0, cause.Error())
}

// handleInvokeStream is InvokeWithResponseStream: an event stream of nlpgo's
// answer, chunk by chunk as nlpgo flushes it, closed by InvokeComplete.
func (s *Server) handleInvokeStream(w http.ResponseWriter, r *http.Request) {
	inv, event := s.begin(w, r, "stream")
	if inv == nil {
		return
	}
	flusher, _ := w.(http.Flusher)
	w.Header().Set("Content-Type", "application/vnd.amazon.eventstream")
	w.Header().Set("X-Amz-Executed-Version", "$LATEST")
	w.WriteHeader(http.StatusOK)
	complete := func(errorCode, details string) {
		fields := map[string]string{}
		if errorCode != "" {
			fields = map[string]string{"ErrorCode": errorCode, "ErrorDetails": details}
			inv.rec.FunctionError = errorCode
		}
		payload, _ := json.Marshal(fields)
		_ = writeEvent(w, "InvokeComplete", "application/json", payload)
		if flusher != nil {
			flusher.Flush()
		}
	}

	if s.settings().ForcedError == ErrorFunctionError {
		complete("Unhandled", "lambdasim forced a function error")
		s.finish(inv, 0, "forced function error")
		return
	}
	res, err := s.forward(r, event)
	if err != nil {
		complete("Unhandled", err.Error())
		s.finish(inv, 0, err.Error())
		return
	}
	defer res.Body.Close()
	chunk := func(payload []byte) error {
		if err := writeEvent(w, "PayloadChunk", "application/octet-stream", payload); err != nil {
			return err
		}
		if flusher != nil {
			flusher.Flush()
		}
		return nil
	}
	if err := chunk(prelude(res)); err != nil {
		s.finish(inv, res.StatusCode, "the caller went away: "+err.Error())
		return
	}
	buf := make([]byte, 32<<10)
	for {
		n, readErr := res.Body.Read(buf)
		if n > 0 {
			if inv.resBody.Len() < s.cfg.MaxBodyBytes {
				inv.resBody.Write(buf[:n])
			}
			if err := chunk(buf[:n]); err != nil {
				s.finish(inv, res.StatusCode, "the caller went away: "+err.Error())
				return
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			complete("Unhandled", readErr.Error())
			s.finish(inv, res.StatusCode, readErr.Error())
			return
		}
	}
	complete("", "")
	s.finish(inv, res.StatusCode, "")
}

// finish records the invocation; status is nlpgo's, or the Lambda status when nlpgo was never reached.
func (s *Server) finish(inv *invocation, status int, failure string) {
	inv.rec.Status, inv.rec.Error = status, failure
	inv.rec.DurationMs = float64(time.Since(inv.started).Microseconds()) / 1000
	inv.rec.Response = keep(inv.resBody.Bytes(), s.cfg.MaxBodyBytes)
	s.calls.add(inv.rec)
}
