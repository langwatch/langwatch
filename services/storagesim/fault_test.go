package storagesim

import (
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestForcedErrorRefusesPutAndGetUntilCleared(t *testing.T) {
	ts := newTestServer(t)
	object := ts.URL + "/langwatch/a.txt"
	settings := func(body string) int {
		resp, _ := do(t, http.MethodPut, ts.URL+"/_sim/api/settings", strings.NewReader(body), nil)
		return resp.StatusCode
	}

	assert.Equal(t, http.StatusOK, settings(`{"forcedError":503}`))
	put, _ := doSigned(t, http.MethodPut, object, strings.NewReader("hi"), nil)
	assert.Equal(t, http.StatusServiceUnavailable, put.StatusCode)
	get, _ := doSigned(t, http.MethodGet, object, nil, nil)
	assert.Equal(t, http.StatusServiceUnavailable, get.StatusCode)

	assert.Equal(t, http.StatusBadRequest, settings(`{"forcedError":200}`))
	assert.Equal(t, http.StatusOK, settings(`{"forcedError":0}`))
	put, _ = doSigned(t, http.MethodPut, object, strings.NewReader("hi"), nil)
	assert.Equal(t, http.StatusOK, put.StatusCode)
}
