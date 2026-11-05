package httpmiddleware

import "strings"

// credentialPathPrefixes are the paths whose last segment is a bearer
// credential. A Twilio relay id is the only secret on the Twilio leg.
var credentialPathPrefixes = []string{"/v1/voice/twilio/", "/relay-hop/"}

// redactedIDLength is how much of such a credential may be recorded.
const redactedIDLength = 8

// RedactPath cuts the credential out of a request path before it is logged
// or put on a span: the id keeps its first 8 characters and then "...".
// Any other path comes back unchanged.
func RedactPath(path string) string {
	for _, prefix := range credentialPathPrefixes {
		id, ok := strings.CutPrefix(path, prefix)
		if !ok || id == "" {
			continue
		}
		if len(id) > redactedIDLength {
			id = id[:redactedIDLength]
		}
		return prefix + id + "..."
	}
	return path
}
