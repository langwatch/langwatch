package mailsim

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestExtractLinksDeduplicatesInOrderOfAppearance(t *testing.T) {
	text := "Verify at https://app.example.com/verify?token=abc, or copy it."
	html := `<a href="https://app.example.com/verify?token=abc">verify</a> then visit https://app.example.com/other.`
	links := extractLinks(text, html)
	assert.Equal(t, []string{
		"https://app.example.com/verify?token=abc",
		"https://app.example.com/other",
	}, links)
}

func TestStoreWaitReturnsExistingMatchImmediately(t *testing.T) {
	st, err := NewStore("")
	require.NoError(t, err)
	require.NoError(t, st.Deliver(&Message{Summary: Summary{Subject: "welcome", To: []string{"a@stack.local"}}}))

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	msg, ok := st.Wait(ctx, "a@stack.local", "welcome")
	require.True(t, ok)
	assert.Equal(t, "welcome", msg.Subject)
}

func TestStoreWaitUnblocksOnArrival(t *testing.T) {
	st, err := NewStore("")
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	resultCh := make(chan *Message, 1)
	go func() {
		msg, ok := st.Wait(ctx, "", "invoice")
		if ok {
			resultCh <- msg
		} else {
			resultCh <- nil
		}
	}()

	time.Sleep(20 * time.Millisecond)
	require.NoError(t, st.Deliver(&Message{Summary: Summary{Subject: "invoice ready"}}))

	select {
	case msg := <-resultCh:
		require.NotNil(t, msg)
		assert.Equal(t, "invoice ready", msg.Subject)
	case <-time.After(2 * time.Second):
		t.Fatal("Wait never unblocked on arrival")
	}
}

func TestStoreWaitTimesOutWithNoMatch(t *testing.T) {
	st, err := NewStore("")
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	_, ok := st.Wait(ctx, "", "nothing-will-match")
	assert.False(t, ok)
}
