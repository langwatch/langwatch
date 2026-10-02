package mailsim

import (
	"context"
	"fmt"
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
	msg, ok := st.Wait(ctx, WaitFilter{To: "a@stack.local", Subject: "welcome"})
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
		msg, ok := st.Wait(ctx, WaitFilter{Subject: "invoice"})
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
	_, ok := st.Wait(ctx, WaitFilter{Subject: "nothing-will-match"})
	assert.False(t, ok)
}

func TestStoreEvictsOldestAtCapAndKeepsIndexesConsistent(t *testing.T) {
	st, err := NewBoundedStore("", 3)
	require.NoError(t, err)
	var ids []string
	for _, to := range []string{"a@x.test", "b@x.test", "a@x.test", "c@x.test"} {
		msg := &Message{Summary: Summary{To: []string{to}, Subject: "s"}}
		require.NoError(t, st.Deliver(msg))
		ids = append(ids, msg.ID)
	}
	_, found := st.Get(ids[0])
	assert.False(t, found, "the oldest message is evicted at the cap")
	assert.Len(t, st.List("", ""), 3)
	assert.Len(t, st.List("a@x.test", ""), 1, "the evicted message leaves the recipient index")
	assert.Len(t, st.List("X.TEST", ""), 3, "recipient filter stays a case-insensitive substring")
	assert.True(t, st.Delete(ids[1]))
	assert.Empty(t, st.List("b@x.test", ""))
}

func TestSeedInboxDeliversSampleMessagesWithLinks(t *testing.T) {
	st, err := NewStore("")
	require.NoError(t, err)
	require.NoError(t, seedInbox(st))
	got := st.List("demo@example.com", "verify")
	require.Len(t, got, 1)
	msg, _ := st.Get(got[0].ID)
	assert.Equal(t, []string{"http://localhost:5560/verify?token=demo-token"}, msg.Links)
}

func benchStore(b *testing.B, n int) *Store {
	b.Helper()
	st, _ := NewBoundedStore("", n)
	for i := range n {
		_ = st.Deliver(&Message{Summary: Summary{To: []string{fmt.Sprintf("u%d@stack.local", i%500)}, Subject: "Verify your email"}})
	}
	return st
}

func BenchmarkListByRecipient(b *testing.B) {
	st := benchStore(b, 10000)
	b.ReportAllocs()
	for b.Loop() {
		st.List("u7@stack.local", "verify")
	}
}

func BenchmarkGetByID(b *testing.B) {
	st := benchStore(b, 10000)
	id := st.List("u7@stack.local", "")[0].ID
	b.ReportAllocs()
	for b.Loop() {
		st.Get(id)
	}
}

func BenchmarkDeliverAtCap(b *testing.B) {
	st := benchStore(b, 10000)
	msg := Summary{To: []string{"u1@stack.local"}, Subject: "Verify your email"}
	b.ReportAllocs()
	for b.Loop() {
		_ = st.Deliver(&Message{Summary: msg})
	}
}
