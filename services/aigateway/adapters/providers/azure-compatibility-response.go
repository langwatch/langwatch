package providers

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/bytedance/sonic"
	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

type azureResponseOptions struct {
	model  string
	fields bfschemas.BifrostResponseExtraFields
}

func azureCompatibilityResponse(resp *bfschemas.BifrostPassthroughResponse, req *domain.Request, model string) (*domain.Response, error) {
	status := resp.StatusCode
	if status == 0 {
		status = http.StatusOK
	}
	out := &domain.Response{Body: resp.Body, StatusCode: status, Headers: passthroughResponseHeaders(resp.Headers)}
	if status >= 200 && status < 300 {
		if err := normalizeAzureCompatibilityResponse(out, req, azureResponseOptions{model: model, fields: resp.ExtraFields}); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func normalizeAzureCompatibilityResponse(out *domain.Response, req *domain.Request, options azureResponseOptions) error {
	fields := options.fields
	fields.PassthroughPath = ""
	model := options.model
	switch req.Type {
	case domain.RequestTypeChat:
		var response bfschemas.BifrostChatResponse
		if err := sonic.Unmarshal(out.Body, &response); err != nil {
			return err
		}
		fields.RequestType = bfschemas.ChatCompletionRequest
		response.ExtraFields = fields
		response.BackfillParams(&bfschemas.BifrostChatRequest{Model: model})
		out.Usage = extractUsage(&response)
		body, err := sonic.Marshal(response)
		out.Body = body
		return err
	case domain.RequestTypeEmbeddings:
		var response bfschemas.BifrostEmbeddingResponse
		if err := sonic.Unmarshal(out.Body, &response); err != nil {
			return err
		}
		fields.RequestType = bfschemas.EmbeddingRequest
		response.ExtraFields = fields
		response.BackfillParams(&bfschemas.BifrostEmbeddingRequest{Model: model})
		out.Usage = extractEmbeddingUsage(&response)
		body, err := sonic.Marshal(response)
		out.Body = body
		return err
	case domain.RequestTypeTranscription:
		return normalizeAzureTranscription(out, req, fields)
	case domain.RequestTypeSpeech:
		return normalizeAzureSpeech(out, req)
	case domain.RequestTypeMessages, domain.RequestTypeResponses, domain.RequestTypePassthrough, domain.RequestTypeRealtimeSession:
		return nil
	}
	return nil
}

func setAzureContentType(out *domain.Response, contentType string) {
	if out.Headers == nil {
		out.Headers = make(map[string]string)
	}
	for key := range out.Headers {
		if strings.EqualFold(key, "Content-Type") {
			delete(out.Headers, key)
		}
	}
	out.Headers["Content-Type"] = contentType
}

func normalizeAzureTranscription(out *domain.Response, req *domain.Request, fields bfschemas.BifrostResponseExtraFields) error {
	var response bfschemas.BifrostTranscriptionResponse
	format := req.Transcription.Params["response_format"]
	if bfschemas.IsPlainTextTranscriptionFormat(&format) {
		response.Text = string(out.Body)
	} else if err := sonic.Unmarshal(out.Body, &response); err != nil {
		return err
	}
	fields.RequestType = bfschemas.TranscriptionRequest
	response.ExtraFields = fields
	out.Usage = extractTranscriptionUsage(&response)
	body, err := sonic.Marshal(response)
	out.Body = body
	setAzureContentType(out, "application/json")
	return err
}

func normalizeAzureSpeech(out *domain.Response, req *domain.Request) error {
	var speech speechWireRequest
	if err := sonic.Unmarshal(req.Body, &speech); err != nil {
		return err
	}
	setAzureContentType(out, audioContentType(speech.ResponseFormat))
	out.Usage.InputChars = utf8.RuneCountInString(speech.Input)
	return nil
}

// Match Bifrost's native SSE reader ceiling so malformed streams cannot grow memory without limit.
const azureMaxFrameBytes = 10 * 1024 * 1024

type azureChatIterator struct {
	model     string
	cancel    context.CancelFunc
	ch        <-chan *bfschemas.BifrostStreamChunk
	chat      bifrostStreamIterator
	pending   []byte
	httpError *domain.UpstreamError
	done      bool
	primed    bool
}

func (it *azureChatIterator) prepare(ctx context.Context) error {
	it.primed = it.Next(ctx)
	return it.Err()
}

func (it *azureChatIterator) Next(ctx context.Context) bool {
	if it.primed {
		it.primed = false
		return true
	}
	for !it.done {
		frame, found := it.popFrame()
		if found {
			if it.decodeFrame(frame) {
				return true
			}
			continue
		}
		it.readChunk(ctx)
	}
	return false
}

func (it *azureChatIterator) popFrame() ([]byte, bool) {
	if it.httpError != nil {
		return nil, false
	}
	end := bytes.Index(it.pending, []byte("\n\n"))
	if end < 0 {
		return nil, false
	}
	frame := it.pending[:end]
	it.pending = it.pending[end+2:]
	return frame, true
}

func (it *azureChatIterator) fail(err error) {
	it.chat.err = err
	_ = it.Close()
}

func (it *azureChatIterator) readChunk(ctx context.Context) {
	select {
	case <-ctx.Done():
		it.fail(ctx.Err())
	case chunk, ok := <-it.ch:
		if !ok {
			it.finish()
			return
		}
		if chunk.BifrostError != nil {
			it.fail(upstreamStreamError(chunk.BifrostError))
			return
		}
		if chunk.BifrostPassthroughResponse != nil {
			it.acceptChunk(chunk.BifrostPassthroughResponse)
		}
	}
}

func (it *azureChatIterator) acceptChunk(response *bfschemas.BifrostPassthroughResponse) {
	if response.StatusCode >= 300 && it.httpError == nil {
		it.httpError = &domain.UpstreamError{StatusCode: response.StatusCode, Headers: forwardableUpstreamHeaders(response.Headers), Provider: "azure", Message: "Azure request failed"}
	}
	if len(it.pending)+len(response.Body) > azureMaxFrameBytes {
		it.fail(fmt.Errorf("azure stream frame exceeds %d bytes", azureMaxFrameBytes))
		return
	}
	it.pending = append(it.pending, response.Body...)
	if it.httpError == nil {
		it.pending = bytes.ReplaceAll(it.pending, []byte("\r\n"), []byte("\n"))
	}
}

func (it *azureChatIterator) finish() {
	if it.httpError != nil {
		it.httpError.Body = append([]byte(nil), it.pending...)
		it.fail(it.httpError)
		return
	}
	if len(bytes.TrimSpace(it.pending)) != 0 {
		it.fail(fmt.Errorf("incomplete Azure stream frame at EOF"))
		return
	}
	_ = it.Close()
}

func azureFrameData(frame []byte) []byte {
	var data [][]byte
	for _, line := range bytes.Split(frame, []byte("\n")) {
		if bytes.HasPrefix(line, []byte("data:")) {
			data = append(data, bytes.TrimPrefix(bytes.TrimPrefix(line, []byte("data:")), []byte(" ")))
		}
	}
	return bytes.TrimSpace(bytes.Join(data, []byte("\n")))
}

func (it *azureChatIterator) decodeFrame(frame []byte) bool {
	data := azureFrameData(frame)
	if len(data) == 0 {
		return false
	}
	if bytes.Equal(data, []byte("[DONE]")) {
		_ = it.Close()
		return false
	}
	var event struct {
		Error *bfschemas.ErrorField `json:"error"`
	}
	if err := sonic.Unmarshal(data, &event); err != nil {
		it.fail(fmt.Errorf("decode Azure chat stream: %w", err))
		return false
	}
	if event.Error != nil {
		it.fail(upstreamStreamError(&bfschemas.BifrostError{Error: event.Error, ExtraFields: bfschemas.BifrostErrorExtraFields{Provider: bfschemas.Azure, RawResponse: string(data)}}))
		return false
	}
	return it.decodeChat(data)
}

func (it *azureChatIterator) decodeChat(data []byte) bool {
	var response bfschemas.BifrostChatResponse
	if err := sonic.Unmarshal(data, &response); err != nil {
		it.fail(err)
		return false
	}
	if response.Object == "" {
		response.Object = "chat.completion.chunk"
	}
	response.BackfillParams(&bfschemas.BifrostChatRequest{Model: it.model})
	it.chat.ensureLeadingRoleDelta(&response)
	it.chat.current, it.chat.err = sonic.Marshal(response)
	if response.Usage != nil {
		it.chat.usage = extractUsage(&response)
	}
	return it.chat.err == nil
}

func (it *azureChatIterator) Chunk() []byte       { return it.chat.Chunk() }
func (it *azureChatIterator) Usage() domain.Usage { return it.chat.Usage() }
func (it *azureChatIterator) Err() error          { return it.chat.Err() }
func (it *azureChatIterator) Close() error {
	it.done = true
	if it.cancel != nil {
		it.cancel()
	}
	return nil
}
