package idpsim

import (
	"net/http"
	"sort"
	"strings"
)

/**
 * The DNS registry: this machine standing in for a domain's registrar.
 *
 * A domain proof is the one step of SSO setup that happens somewhere else, and
 * locally `acme.test` has no registrar, so the tenant page walks it instead.
 * The value is LangWatch's (minted and shown once); this takes it rather than
 * generating one, or it would prove a domain against a token never issued.
 */

// verificationLabel is the label LangWatch publishes its proof under, so the
// registry answers the name the verifier actually asks for rather than one
// that merely looks right.
const verificationLabel = "_langwatch-verification"

/**
 * The record name and the bare domain, from whichever of the two was typed:
 * LangWatch's panel shows the name, a registrar console wants the bare domain,
 * and both are the same record.
 */
func verificationTarget(typed string) (name, domain string) {
	normalized := normalizeDomain(typed)
	if normalized == "" {
		return "", ""
	}
	if after, found := strings.CutPrefix(normalized, verificationLabel+"."); found {
		return normalized, after
	}
	return verificationLabel + "." + normalized, normalized
}

// publishedRecord is one TXT answer this machine is serving.
type publishedRecord struct {
	Name  string `json:"name"`
	Value string `json:"value"`
	// Verifies is true when this record sits at the name a LangWatch check
	// asks for. The seeded records sit at the bare domain, which no verifier
	// queries, so the page must not draw them as if they proved anything.
	Verifies bool `json:"verifies"`
}

/**
 * What the registry is answering for this tenant: scoped to its own domain,
 * because the store is machine-wide and another tenant's records are somebody
 * else's business. Name-ordered, so the table does not reshuffle.
 */
func (s *Server) publishedRecords(domain string) []publishedRecord {
	txt, _ := s.verification.Snapshot()
	zone := normalizeDomain(domain)
	records := make([]publishedRecord, 0, len(txt))
	for name, values := range txt {
		if name != zone && !strings.HasSuffix(name, "."+zone) {
			continue
		}
		records = append(records, publishedRecord{
			Name:     name,
			Value:    strings.Join(values, " "),
			Verifies: strings.HasPrefix(name, verificationLabel+"."),
		})
	}
	sort.Slice(records, func(i, j int) bool { return records[i].Name < records[j].Name })
	return records
}

/**
 * Publish a verification value on both channels at once: the product offers
 * both, and a person pasting a value cannot know which one the check will use.
 * The TXT record goes at the name the verifier asks for; the same value is
 * served as the well-known file for the bare domain.
 */
func (s *Server) handlePublishVerification(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name  string `json:"name"`
		Value string `json:"value"`
	}
	t, ok := s.apiTenantAndBody(w, r, &body)
	if !ok {
		return
	}
	name, domain := verificationTarget(body.Name)
	value := strings.TrimSpace(body.Value)
	if name == "" || value == "" {
		writeRefusal(w, refusalNotice{
			Status: http.StatusBadRequest,
			Title:  "A record needs a name and a value",
			Detail: "Publishing puts one value where a verifier will look for it, so it needs to know both.",
			Hint:   "Both are on the LangWatch screen that asked you to prove the domain — the value is shown once, when it is issued.",
		})
		return
	}
	// Pasting the name into both boxes is the one easy accident; say so rather
	// than publish a record that proves itself.
	if normalizeDomain(value) == name {
		writeRefusal(w, refusalNotice{
			Status: http.StatusBadRequest,
			Title:  "That is the record's name, not its value",
			Detail: "The name says where the record goes; the value is the secret LangWatch minted to put there.",
			Hint:   "On the LangWatch screen the value is the row under the name, shown once when the record is issued.",
		})
		return
	}
	s.verification.SetTXT(name, []string{value})
	s.verification.SetToken(domain, value)
	s.record(t, Event{
		Kind:    "verification.publish",
		Outcome: OutcomeOK,
		Detail:  "published the verification value at " + name + " and under /.well-known/",
	})
	writeJSON(w, http.StatusOK, publishedRecord{Name: name, Value: value, Verifies: true})
}

// handleUnpublishVerification takes a record back out, which is how a lapsed
// proof is watched: the checker simply stops finding it.
func (s *Server) handleUnpublishVerification(w http.ResponseWriter, r *http.Request) {
	t, ok := s.apiTenant(w, r)
	if !ok {
		return
	}
	name := normalizeDomain(r.PathValue("name"))
	if name == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	s.verification.RemoveTXT(name)
	// The well-known token is keyed by the bare domain; leaving it behind would
	// let a proof the page reports as gone keep succeeding down that channel.
	s.verification.RemoveToken(strings.TrimPrefix(name, verificationLabel+"."))
	s.record(t, Event{
		Kind:    "verification.unpublish",
		Outcome: OutcomeOK,
		Detail:  "took the verification value at " + name + " back out",
	})
	w.WriteHeader(http.StatusNoContent)
}
