package httpapi

import (
	"bytes"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"

	"github.com/bytedance/sonic"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Brokered voice calls. The caller sends its WebRTC offer here, the gateway
// makes the vendor's call setup with the provider key and returns the answer.
// Media then runs client to vendor; the gateway meters the call from its own
// server-side socket and can end it.

// voiceBrokerRetryAfter is what a refused setup request is told to wait.
const voiceBrokerRetryAfter = 5

// openAILiveSessionHandler terminates POST /v1/live/sessions, OpenAI Live's
// own session route, for the WebRTC transport.
func openAILiveSessionHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}
		body, ok := readFullBody(deps.Logger, w, r, maxRealtimeMintBodyBytes)
		if !ok {
			return
		}
		broker := voiceBroker{deps: deps, w: w, r: r}
		root := gjson.ParseBytes(body)
		if problem := liveOfferProblem(root); problem != "" {
			broker.refuse(problem)
			return
		}
		broker.dispatch(bundle, app.RealtimeMintDispatch{
			Body:  body,
			Model: root.Get("session.model").String(),
			Session: domain.RealtimeSessionRequest{
				Vendor: domain.RealtimeVendorOpenAI,
				Broker: domain.RealtimeBrokerLive,
			},
			Surface: domain.OpenAILiveSurface(),
		})
	}
}

// openAIRealtimeCallHandler terminates POST /v1/realtime/calls, OpenAI
// Realtime's WebRTC call route. It takes the vendor's multipart form, or a
// raw SDP offer with the model in the query string.
func openAIRealtimeCallHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}
		body, ok := readFullBody(deps.Logger, w, r, maxRealtimeMintBodyBytes)
		if !ok {
			return
		}
		broker := voiceBroker{deps: deps, w: w, r: r}
		offer, problem := readRealtimeCallOffer(r, body)
		if problem != "" {
			broker.refuse(problem)
			return
		}
		// The session rides in a JSON body so the model resolver, the policy
		// rules and the booking read it like every other session request.
		sessionBody, err := sjson.SetRawBytes([]byte(`{}`), "session", offer.session)
		if err != nil {
			broker.refuse("the session part is not valid JSON")
			return
		}
		broker.dispatch(bundle, app.RealtimeMintDispatch{
			Body:  sessionBody,
			Model: gjson.GetBytes(offer.session, "model").String(),
			Session: domain.RealtimeSessionRequest{
				Vendor: domain.RealtimeVendorOpenAI,
				Broker: domain.RealtimeBrokerCall,
				SDP:    offer.sdp,
			},
			Surface: domain.OpenAIRealtimeCallSurface(),
		})
	}
}

// realtimeCallOffer is a call setup request read into its two parts.
type realtimeCallOffer struct {
	sdp     []byte
	session []byte
}

// readRealtimeCallOffer reads either form of the request. The second result
// says what is wrong with it, and is empty when nothing is.
func readRealtimeCallOffer(r *http.Request, body []byte) (realtimeCallOffer, string) {
	contentType, params, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	switch contentType {
	case "application/sdp":
		model := strings.TrimSpace(r.URL.Query().Get("model"))
		session, err := sonic.Marshal(map[string]string{"type": "realtime", "model": model})
		if err != nil {
			return realtimeCallOffer{}, "could not read the model query parameter"
		}
		return checkRealtimeCallOffer(realtimeCallOffer{sdp: body, session: session})
	case "multipart/form-data":
		offer, err := readRealtimeCallForm(body, params["boundary"])
		if err != nil {
			return realtimeCallOffer{}, "could not read the multipart form: " + err.Error()
		}
		return checkRealtimeCallOffer(offer)
	default:
		return realtimeCallOffer{}, `send multipart/form-data with parts "sdp" and "session", or application/sdp with ?model=`
	}
}

func checkRealtimeCallOffer(offer realtimeCallOffer) (realtimeCallOffer, string) {
	if len(bytes.TrimSpace(offer.sdp)) == 0 {
		return offer, "the SDP offer is required"
	}
	if !gjson.ParseBytes(offer.session).IsObject() {
		return offer, `the "session" part must be a JSON object`
	}
	return offer, ""
}

func readRealtimeCallForm(body []byte, boundary string) (realtimeCallOffer, error) {
	var offer realtimeCallOffer
	reader := multipart.NewReader(bytes.NewReader(body), boundary)
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			return offer, nil
		}
		if err != nil {
			return offer, err
		}
		content, err := io.ReadAll(part)
		if err != nil {
			return offer, err
		}
		switch part.FormName() {
		case "sdp":
			offer.sdp = content
		case "session":
			offer.session = content
		}
	}
}

// liveOfferProblem says what is wrong with a Live session request, and is
// empty when nothing is.
func liveOfferProblem(root gjson.Result) string {
	switch {
	case !root.IsObject():
		return `the body must be a JSON object with "session" and "transport"`
	case root.Get("transport.type").String() != "webrtc":
		return `only transport.type "webrtc" is brokered on this route: the WebSocket transport is not`
	case root.Get("transport.sdp").String() == "":
		return "transport.sdp is required: send the WebRTC offer"
	}
	return ""
}

// voiceBroker is one call setup request being answered.
type voiceBroker struct {
	deps RouterDeps
	w    http.ResponseWriter
	r    *http.Request
}

// dispatch runs the call setup and writes the vendor's answer with its own
// status, which is 201 for both routes.
func (b voiceBroker) dispatch(bundle *domain.Bundle, dispatch app.RealtimeMintDispatch) {
	result, err := b.deps.App.HandleRealtimeSession(b.r.Context(), bundle, dispatch)
	if err != nil {
		if herr.IsCode(err, domain.ErrVoiceBrokerUnavailable) {
			b.w.Header().Set("Retry-After", strconv.Itoa(voiceBrokerRetryAfter))
		}
		writeError(b.deps.Logger, b.w, b.r.Context(), err)
		return
	}
	setMetaHeaders(b.w, result.Meta)
	writeJSONResponse(b.w, result.Response)
}

func (b voiceBroker) refuse(message string) {
	writeError(b.deps.Logger, b.w, b.r.Context(), herr.New(b.r.Context(), domain.ErrBadRequest, herr.M{
		"message": message,
		"fault":   "customer",
	}))
}
