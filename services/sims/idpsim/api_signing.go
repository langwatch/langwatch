package idpsim

// signingView is what a tenant signs with and the faults armed against it,
// so the console shows the state its signing controls change.
type signingView struct {
	Keys        []string `json:"keys"`
	SkewSeconds int      `json:"skewSeconds"`
	Armed       string   `json:"armed"`
}

func signingViewOf(t *Tenant) signingView {
	keys := []string{}
	for _, k := range t.SigningKeys() {
		keys = append(keys, k.KID)
	}
	return signingView{Keys: keys, SkewSeconds: int(t.Skew().Seconds()), Armed: string(t.ArmedTamper())}
}

// ArmedTamper is the one-shot break waiting for the next response, or TamperNone.
func (t *Tenant) ArmedTamper() TamperMode {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.tamper
}
