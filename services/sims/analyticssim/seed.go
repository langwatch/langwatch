package analyticssim

import "encoding/json"

// seedPostHog and seedCustomerIO are sample provider calls, pushed through the
// same normalizers a real call takes, so the console starts with content.
const seedPostHog = `{"batch":[
 {"event":"$identify","distinct_id":"user_demo_1","properties":{"$set":{"email":"demo@example.com","plan":"pro"}}},
 {"event":"trace_viewed","distinct_id":"user_demo_1","properties":{"project":"demo"}},
 {"event":"$pageview","distinct_id":"user_demo_2","properties":{"$current_url":"http://localhost:5560/demo"}}]}`

const seedCustomerIO = `{"userId":"user_demo_1","traits":{"email":"demo@example.com","firstName":"Demo"}}`

// seedRecords is the sample content loaded when ANALYTICSSIM_SEED=1.
func seedRecords() []Record {
	out, _ := NormalizePostHog([]byte(seedPostHog))
	if cio, err := NormalizeCustomerIOCDP("identify", json.RawMessage(seedCustomerIO)); err == nil {
		out = append(out, cio...)
	}
	return out
}
