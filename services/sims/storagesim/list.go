package storagesim

import (
	"encoding/base64"
	"encoding/xml"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// maxListKeys is S3's page ceiling and default for ListObjectsV2.
const maxListKeys = 1000

// listBucketResult is ListObjectsV2's answer, in the AWS XML shape.
type listBucketResult struct {
	XMLName               xml.Name       `xml:"http://s3.amazonaws.com/doc/2006-03-01/ ListBucketResult"`
	Name                  string         `xml:"Name"`
	Prefix                string         `xml:"Prefix"`
	Delimiter             string         `xml:"Delimiter,omitempty"`
	MaxKeys               int            `xml:"MaxKeys"`
	KeyCount              int            `xml:"KeyCount"`
	IsTruncated           bool           `xml:"IsTruncated"`
	ContinuationToken     string         `xml:"ContinuationToken,omitempty"`
	NextContinuationToken string         `xml:"NextContinuationToken,omitempty"`
	StartAfter            string         `xml:"StartAfter,omitempty"`
	Contents              []listEntry    `xml:"Contents"`
	CommonPrefixes        []commonPrefix `xml:"CommonPrefixes"`
}

type listEntry struct {
	Key          string `xml:"Key"`
	LastModified string `xml:"LastModified"`
	ETag         string `xml:"ETag"`
	Size         int64  `xml:"Size"`
	StorageClass string `xml:"StorageClass"`
}

type commonPrefix struct {
	Prefix string `xml:"Prefix"`
}

// listObjectsV2 answers GET /<bucket>?list-type=2: keys in lexical order, paged by
// an opaque token that encodes the last key the page consumed.
func (s *Server) listObjectsV2(x exchange, obj object) {
	if !s.bucketExists(obj.bucket) {
		x.fail(obj.noSuchBucket())
		return
	}
	q := x.r.URL.Query()
	page := listBucketResult{Name: obj.bucket, Prefix: q.Get("prefix"), Delimiter: q.Get("delimiter"),
		ContinuationToken: q.Get("continuation-token"), StartAfter: q.Get("start-after")}
	maxKeys, e := parseMaxKeys(q.Get("max-keys"), obj)
	if e != nil {
		x.fail(*e)
		return
	}
	after, e := page.start(obj)
	if e != nil {
		x.fail(*e)
		return
	}
	page.MaxKeys = maxKeys
	// ponytail: reads every sidecar per page; an index if a bucket grows past thousands.
	page.fill(s.bucketObjects(obj.bucket), after)
	x.w.Header().Set("Content-Type", "application/xml")
	x.w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(x.w, xml.Header)
	_ = xml.NewEncoder(x.w).Encode(page)
}

func parseMaxKeys(raw string, obj object) (int, *s3Error) {
	if raw == "" {
		return maxListKeys, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return 0, new(obj.fail(http.StatusBadRequest, "InvalidArgument", "Provided max-keys not an integer or within integer range"))
	}
	return min(n, maxListKeys), nil
}

// start is the key the page lists after: the token's, else start-after.
func (p *listBucketResult) start(obj object) (string, *s3Error) {
	if p.ContinuationToken == "" {
		return p.StartAfter, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(p.ContinuationToken)
	if err != nil {
		return "", new(obj.fail(http.StatusBadRequest, "InvalidArgument", "The continuation token provided is incorrect"))
	}
	return string(raw), nil
}

func (s *Server) bucketObjects(bucket string) []objectInfo {
	var out []objectInfo
	for _, o := range s.listObjects() {
		if o.Bucket == bucket {
			out = append(out, o)
		}
	}
	return out
}

// fill pages objects (sorted by key) after the given key. Keys rolled into the
// last common prefix are consumed with it, so the next page never repeats it.
func (p *listBucketResult) fill(objects []objectInfo, after string) {
	last, lastPrefix := "", ""
	for _, o := range objects {
		if o.Key <= after || !strings.HasPrefix(o.Key, p.Prefix) {
			continue
		}
		common := p.commonPrefix(o.Key)
		if common != "" && common == lastPrefix {
			last = o.Key
			continue
		}
		if p.KeyCount == p.MaxKeys {
			p.IsTruncated = p.MaxKeys > 0
			break
		}
		p.add(o, common)
		last, lastPrefix = o.Key, common
	}
	if p.IsTruncated {
		p.NextContinuationToken = base64.RawURLEncoding.EncodeToString([]byte(last))
	}
}

func (p *listBucketResult) commonPrefix(key string) string {
	if p.Delimiter == "" {
		return ""
	}
	rest := key[len(p.Prefix):]
	i := strings.Index(rest, p.Delimiter)
	if i < 0 {
		return ""
	}
	return p.Prefix + rest[:i+len(p.Delimiter)]
}

func (p *listBucketResult) add(o objectInfo, common string) {
	p.KeyCount++
	if common != "" {
		p.CommonPrefixes = append(p.CommonPrefixes, commonPrefix{Prefix: common})
		return
	}
	p.Contents = append(p.Contents, listEntry{Key: o.Key, LastModified: o.LastModified.Format("2006-01-02T15:04:05.000Z"),
		ETag: o.ETag, Size: o.Size, StorageClass: "STANDARD"})
}
