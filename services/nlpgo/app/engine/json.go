package engine

import "encoding/json"

// jsonUnmarshalCompat is a small wrapper that gives us a single point
// to swap the JSON library if we ever switch to sonic for parity with
// the gateway's hot path.
func jsonUnmarshalCompat(b []byte, v any) error {
	return json.Unmarshal(b, v)
}
