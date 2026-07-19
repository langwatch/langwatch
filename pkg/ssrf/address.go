// Package ssrf holds the canonical address-classification rules shared by every
// LangWatch service that makes tenant-directed outbound requests.
//
// Before this package the same "is this IP safe to egress to?" decision was
// re-implemented independently in the AI gateway customer-endpoint validator,
// the Langy egress proxy, the TypeScript app (utils/ssrfProtection.ts) and the
// Python NLP service. They drifted: the Langy proxy blocked neither NAT64 nor
// 6to4, the gateway blocked local-use NAT64 but not the well-known prefix, and
// the TypeScript path never covered CGNAT, benchmarking or documentation
// ranges. A tenant who controls DNS can steer a request into whichever gap a
// given service left open, so the rule set must be one thing, expressed once.
//
// The Go implementation lives here; the byte-for-byte equivalent TypeScript
// implementation lives in the @langwatch/ssrf workspace package. Both are held
// to the same behaviour by the shared conformance corpus in
// testdata/address_vectors.json — if the two languages ever disagree about any
// vector, one of the two test suites fails.
//
// References (the prefix set is the union of the two IANA registries; every
// entry below is named with its RFC at the point of declaration):
//   - IANA IPv4 Special-Purpose Address Registry:
//     https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml
//   - IANA IPv6 Special-Purpose Address Registry:
//     https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml
//   - AWS EKS, "Restrict the use of host networking and block access to the
//     instance metadata service" (block egress to 169.254.0.0/16; IMDSv2 hop
//     limit 1): https://docs.aws.amazon.com/whitepapers/latest/security-practices-multi-tenant-saas-applications-eks/restrict-the-use-of-host-networking-and-block-access-to-instance-metadata-service.html
package ssrf

import "net/netip"

// Category classifies an IP address by how an egress boundary must treat it.
type Category int

const (
	// CategoryGlobal is a globally routable address — the only category that is
	// ever a legitimate outbound destination.
	CategoryGlobal Category = iota
	// CategoryMetadata is a cloud instance-metadata / instance-identity
	// endpoint. It is never a legitimate destination and is refused regardless
	// of whether private egress is otherwise permitted.
	CategoryMetadata
	// CategorySpecial is any other non-globally-routable address (loopback,
	// RFC1918, unique-local, link-local, CGNAT, benchmarking, documentation,
	// reserved, NAT64, 6to4, …). It is refused when local/private egress is
	// disallowed — i.e. always on hosted SaaS, optionally on self-hosted.
	CategorySpecial
)

func (c Category) String() string {
	switch c {
	case CategoryGlobal:
		return "global"
	case CategoryMetadata:
		return "metadata"
	case CategorySpecial:
		return "special"
	default:
		return "unknown"
	}
}

// metadataAddresses are cloud instance-metadata endpoints. Most sit inside a
// range the predicates below already catch (169.254.169.254 is link-local,
// fd00:ec2::254 is unique-local), but they are singled out so a caller that
// permits private egress still refuses metadata. 168.63.129.16 (Azure
// WireServer) is the exception that makes this map load-bearing: it is a
// globally-routable-looking address in no special range at all.
var metadataAddresses = map[netip.Addr]struct{}{
	// AWS/GCP/Azure/Oracle Instance Metadata Service (IMDS). Reaching it from a
	// tenant-directed request is the classic credential-theft SSRF.
	// AWS:   https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html
	// GCP:   https://cloud.google.com/compute/docs/metadata/overview (also metadata.google.internal)
	// Azure: https://learn.microsoft.com/azure/virtual-machines/instance-metadata-service
	netip.MustParseAddr("169.254.169.254"): {},
	// AWS ECS/Fargate task metadata + credential endpoint.
	// https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-metadata-endpoint-v4.html
	netip.MustParseAddr("169.254.170.2"): {},
	// Azure WireServer / host communication + platform DNS. A Microsoft-owned
	// virtual public IP (not in any RFC special range), identical in every
	// region — hence the explicit entry.
	// https://learn.microsoft.com/azure/virtual-network/what-is-ip-address-168-63-129-16
	netip.MustParseAddr("168.63.129.16"): {},
	// AWS EC2 IMDS reached over IPv6.
	// https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-IMDS-existing-instances.html
	netip.MustParseAddr("fd00:ec2::254"): {},
}

// specialPrefixes are the non-globally-routable ranges NOT already reported by
// netip.Addr's own predicates (IsUnspecified/IsLoopback/IsPrivate/
// IsLinkLocalUnicast/IsLinkLocalMulticast/IsMulticast). Sourced from the IANA
// IPv4 and IPv6 Special-Purpose Address Registries; the NAT64 and 6to4 prefixes
// are refused wholesale rather than decoded to their embedded IPv4 because no
// legitimate LangWatch egress ever targets a translated address.
var specialPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),       // "this host on this network" (RFC 1122)
	netip.MustParsePrefix("100.64.0.0/10"),   // CGNAT / shared address space (RFC 6598)
	netip.MustParsePrefix("192.0.0.0/24"),    // IETF protocol assignments (RFC 6890)
	netip.MustParsePrefix("192.0.2.0/24"),    // TEST-NET-1 documentation (RFC 5737)
	netip.MustParsePrefix("192.88.99.0/24"),  // 6to4 relay anycast, deprecated (RFC 7526)
	netip.MustParsePrefix("198.18.0.0/15"),   // benchmarking (RFC 2544)
	netip.MustParsePrefix("198.51.100.0/24"), // TEST-NET-2 documentation (RFC 5737)
	netip.MustParsePrefix("203.0.113.0/24"),  // TEST-NET-3 documentation (RFC 5737)
	netip.MustParsePrefix("240.0.0.0/4"),     // reserved incl. 255.255.255.255 (RFC 1112 / RFC 919)
	netip.MustParsePrefix("64:ff9b::/96"),    // well-known NAT64 (RFC 6052) — embeds IPv4
	netip.MustParsePrefix("64:ff9b:1::/48"),  // local-use NAT64 (RFC 8215)
	netip.MustParsePrefix("100::/64"),        // discard-only (RFC 6666)
	netip.MustParsePrefix("2001::/32"),       // Teredo IPv4-over-IPv6 tunnel (RFC 4380)
	netip.MustParsePrefix("2001:db8::/32"),   // documentation (RFC 3849)
	netip.MustParsePrefix("2002::/16"),       // 6to4 (RFC 3056) — embeds IPv4
	netip.MustParsePrefix("3fff::/20"),       // documentation (RFC 9637)
}

// Classify reports how an egress boundary must treat addr. An invalid address
// is treated as CategorySpecial so a parse failure fails closed rather than
// slipping through as "not obviously private". IPv4-mapped IPv6 addresses
// (::ffff:a.b.c.d) are unmapped first so they classify as their IPv4 form.
func Classify(addr netip.Addr) Category {
	if !addr.IsValid() {
		return CategorySpecial
	}
	addr = addr.Unmap()

	if _, ok := metadataAddresses[addr]; ok {
		return CategoryMetadata
	}

	if addr.IsUnspecified() || addr.IsLoopback() || addr.IsPrivate() ||
		addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() || addr.IsMulticast() {
		return CategorySpecial
	}

	for _, prefix := range specialPrefixes {
		if prefix.Contains(addr) {
			return CategorySpecial
		}
	}

	return CategoryGlobal
}

// IsPublicAddress reports whether addr is globally routable and therefore the
// only class of address a strict egress boundary may dial. Use this where every
// non-public address must be refused (the Langy proxy, provider dispatch).
func IsPublicAddress(addr netip.Addr) bool {
	return Classify(addr) == CategoryGlobal
}

// Blocked reports whether addr must be refused. Metadata is always refused;
// other special-purpose addresses are refused only when blockLocal is set —
// hosted SaaS sets it, self-hosted installs may leave it off to reach internal
// services. A global address is never blocked here.
func Blocked(addr netip.Addr, blockLocal bool) bool {
	switch Classify(addr) {
	case CategoryMetadata:
		return true
	case CategorySpecial:
		return blockLocal
	default:
		return false
	}
}
