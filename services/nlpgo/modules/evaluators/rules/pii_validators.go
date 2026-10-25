package rules

import (
	"bytes"
	"crypto/sha256"
	"math/big"
	"net/netip"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/net/publicsuffix"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

// validatePII is each recognizer's validate_result: decided is false where
// Presidio answers None and the pattern score stands.
func validatePII(entity contract.EntityType, text string) (valid, decided bool) {
	switch entity {
	case "CREDIT_CARD":
		return luhnValid(dashesAndSpacesRemoved(text)), true
	case "MEDICAL_LICENSE":
		return deaChecksumValid(dashesAndSpacesRemoved(text)), true
	case "UK_NHS":
		return nhsChecksumValid(dashesAndSpacesRemoved(text)), true
	case "CRYPTO":
		return cryptoAddressValid(text), true
	case "EMAIL_ADDRESS":
		return emailDomainValid(text), true
	}
	return false, false
}

// invalidatePII is each recognizer's invalidate_result.
func invalidatePII(entity contract.EntityType, text string) bool {
	switch entity {
	case "US_SSN":
		return ssnInvalid(text)
	case "IP_ADDRESS":
		return !ipInterfaceValid(text)
	}
	return false
}

func dashesAndSpacesRemoved(text string) string {
	return strings.NewReplacer("-", "", " ", "").Replace(text)
}

// digitValues are Python's int() of each character; ok is false on a
// character int() refuses.
func digitValues(text string) (digits []int, ok bool) {
	for _, r := range text {
		if !unicode.IsDigit(r) {
			return nil, false
		}
		digits = append(digits, unicodeDigit(r))
	}
	return digits, true
}

// unicodeDigit is a decimal digit's value in any script: Unicode lays each
// script's digits out as runs of ten from zero.
func unicodeDigit(r rune) int {
	below := 0
	for unicode.IsDigit(r - rune(below) - 1) {
		below++
	}
	return below % 10
}

// luhnValid is CreditCardRecognizer.__luhn_checksum.
func luhnValid(text string) bool {
	digits, ok := digitValues(text)
	if !ok || len(digits) == 0 {
		return false
	}
	sum := 0
	for i := range digits {
		d := digits[len(digits)-1-i]
		if i%2 == 1 {
			d *= 2
			d = d/10 + d%10
		}
		sum += d
	}
	return sum%10 == 0
}

// deaChecksumValid is MedicalLicenseRecognizer.__luhn_checksum over the
// seven digits after the two letters.
func deaChecksumValid(text string) bool {
	runes := []rune(text)
	if len(runes) < 3 {
		return false
	}
	digits, ok := digitValues(string(runes[2:]))
	if !ok {
		return false
	}
	checksum := -digits[len(digits)-1]
	rest := digits[:len(digits)-1]
	for i := range rest {
		d := rest[len(rest)-1-i]
		if i%2 == 0 {
			checksum += 2 * d
		} else {
			checksum += d
		}
	}
	return pyMod(checksum, 10) == 0
}

// nhsChecksumValid is NhsRecognizer.validate_result: weights 10 down to 2
// over the first nine digits and 1 on the check digit, total mod 11.
func nhsChecksumValid(text string) bool {
	digits, ok := digitValues(text)
	if !ok {
		return false
	}
	total := 0
	for i := 0; i < len(digits) && i < 11; i++ {
		total += digits[i] * (10 - i)
	}
	return total%11 == 0
}

func pyMod(a, b int) int {
	return ((a % b) + b) % b
}

// ssnInvalid is UsSsnRecognizer.invalidate_result.
func ssnInvalid(text string) bool {
	digits := ssnDigits(text)
	if ssnDelimitersMixed(text) || len(digits) == 0 || allSameRune(digits) || ssnReservedGroups(digits) {
		return true
	}
	only := string(digits)
	return only == "123456789" || only == "987654320" || only == "078051120"
}

func ssnDelimitersMixed(text string) bool {
	seen := map[rune]bool{}
	for _, r := range text {
		if r == '.' || r == '-' || r == ' ' {
			seen[r] = true
		}
	}
	return len(seen) > 1
}

func ssnDigits(text string) []rune {
	var digits []rune
	for _, r := range text {
		if unicode.IsDigit(r) {
			digits = append(digits, r)
		}
	}
	return digits
}

func allSameRune(runes []rune) bool {
	for _, r := range runes {
		if r != runes[0] {
			return false
		}
	}
	return true
}

// ssnReservedGroups is a 00 group, a 0000 serial, or area 000 or 666.
func ssnReservedGroups(d []rune) bool {
	if len(d) >= 5 && (string(d[3:5]) == "00" || string(d[5:]) == "0000") {
		return true
	}
	return len(d) >= 3 && (string(d[:3]) == "000" || string(d[:3]) == "666")
}

// ipInterfaceValid is Python's ipaddress.ip_interface accepting the text:
// an address, optionally with a decimal prefix length in range.
func ipInterfaceValid(text string) bool {
	addrText, bits, hasBits := strings.Cut(text, "/")
	addr, err := netip.ParseAddr(addrText)
	if err != nil {
		return false
	}
	if !hasBits {
		return true
	}
	if bits == "" || strings.TrimLeft(bits, "0123456789") != "" {
		return false
	}
	n, err := strconv.Atoi(bits)
	return err == nil && n <= addr.BitLen()
}

// emailDomainValid is tldextract's fqdn being non-empty: the host after the
// last '@' ends in an ICANN public suffix with a label before it.
func emailDomainValid(text string) bool {
	host := strings.ToLower(text[strings.LastIndex(text, "@")+1:])
	labels := strings.Split(host, ".")
	for i := range labels {
		candidate := strings.Join(labels[i:], ".")
		if suffix, icann := publicsuffix.PublicSuffix(candidate); icann && suffix == candidate {
			return i > 0 && labels[i-1] != ""
		}
	}
	return false
}

// validateIBAN is IbanRecognizer.validate_result: the check digits, then the
// country format; a lower-case value in a valid format stays undecided.
func (p *PIIPatterns) validateIBAN(text string) (valid, decided bool) {
	value := dashesAndSpacesRemoved(text)
	if len(value) < 4 || !ibanCheckDigitsMatch(value) {
		return false, true
	}
	if p.ibanFormatValid(value) {
		return true, true
	}
	if p.ibanFormatValid(strings.ToUpper(value)) {
		return false, false
	}
	return false, true
}

func (p *PIIPatterns) ibanFormatValid(value string) bool {
	re, ok := p.iban[value[:2]]
	if !ok {
		return false
	}
	matched, err := re.MatchString(value)
	return err == nil && matched
}

// ibanCheckDigitsMatch computes the ISO 13616 check digits as Presidio does.
func ibanCheckDigitsMatch(value string) bool {
	upper := strings.ToUpper(value)
	if !isASCII(upper) {
		return false
	}
	rearranged := upper[4:] + upper[:2] + "00"
	var number strings.Builder
	for _, r := range rearranged {
		switch {
		case r >= '0' && r <= '9':
			number.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			number.WriteString(strconv.Itoa(int(r-'A') + 10))
		default:
			return false
		}
	}
	n, ok := new(big.Int).SetString(number.String(), 10)
	if !ok {
		return false
	}
	check := 98 - new(big.Int).Mod(n, big.NewInt(97)).Int64()
	want := strconv.FormatInt(check, 10)
	if len(want) < 2 {
		want = "0" + want
	}
	return want == value[2:4]
}

func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= 0x80 {
			return false
		}
	}
	return true
}

const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

// cryptoAddressValid is CryptoRecognizer.validate_result: base58check for
// addresses starting 1 or 3, bech32 or bech32m for bc1.
func cryptoAddressValid(text string) bool {
	switch {
	case strings.HasPrefix(text, "1") || strings.HasPrefix(text, "3"):
		return base58CheckValid(text)
	case strings.HasPrefix(text, "bc1"):
		return bech32Valid(text)
	}
	return false
}

func base58CheckValid(text string) bool {
	trimmed := strings.TrimLeft(text, "1")
	n := new(big.Int)
	for _, r := range trimmed {
		i := strings.IndexRune(base58Alphabet, r)
		if i < 0 {
			return false
		}
		n.Mul(n, big.NewInt(58))
		n.Add(n, big.NewInt(int64(i)))
	}
	decoded := append(make([]byte, len(text)-len(trimmed)), n.Bytes()...)
	if len(decoded) < 4 {
		return false
	}
	first := sha256.Sum256(decoded[:len(decoded)-4])
	second := sha256.Sum256(first[:])
	return bytes.Equal(second[:4], decoded[len(decoded)-4:])
}

const bech32Charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

func bech32Valid(text string) bool {
	lower, pos, ok := bech32Parts(text)
	if !ok {
		return false
	}
	values, ok := bech32Values(lower, pos)
	if !ok {
		return false
	}
	polymod := bech32Polymod(values)
	return polymod == 1 || polymod == 0x2bc830a3
}

// bech32Parts is bech32_decode's shape checks: printable ASCII in one case,
// a separator '1' leaving a human part and six checksum characters.
func bech32Parts(text string) (lower string, pos int, ok bool) {
	mixedCase := strings.ToLower(text) != text && strings.ToUpper(text) != text
	if mixedCase || strings.ContainsFunc(text, func(r rune) bool { return r < 33 || r > 126 }) {
		return "", 0, false
	}
	lower = strings.ToLower(text)
	pos = strings.LastIndex(lower, "1")
	return lower, pos, pos >= 1 && pos+7 <= len(lower) && len(lower) <= 90
}

// bech32Values are the expanded human part and the data part's values.
func bech32Values(lower string, pos int) ([]int, bool) {
	hrp := lower[:pos]
	values := make([]int, 0, len(lower)+pos+1)
	for _, r := range hrp {
		values = append(values, int(r)>>5)
	}
	values = append(values, 0)
	for _, r := range hrp {
		values = append(values, int(r)&31)
	}
	for _, r := range lower[pos+1:] {
		i := strings.IndexRune(bech32Charset, r)
		if i < 0 {
			return nil, false
		}
		values = append(values, i)
	}
	return values, true
}

func bech32Polymod(values []int) int {
	generator := [5]int{0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3}
	chk := 1
	for _, v := range values {
		top := chk >> 25
		chk = (chk&0x1ffffff)<<5 ^ v
		for i := range 5 {
			if (top>>i)&1 == 1 {
				chk ^= generator[i]
			}
		}
	}
	return chk
}
