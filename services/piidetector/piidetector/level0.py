"""Level 0: PII found by regular expressions and checksum validators. No models, no names.

`detect(text)` returns spans `{start, end, label, score: None, src: "l0:<detector>"}`.

Each detector is a pattern plus, where the format has one, a validator (Luhn, IBAN mod 97,
national ID check digits, base58check). The detector set in `FROZEN` was chosen on a benchmark
dev split: a detector stayed if its precision there was at least 0.6. `hexkey` and `idcue`
are kept in the code but are not in `FROZEN` (precision 0.25 each).

`LEVEL0_DETECTORS` is what the service runs: `FROZEN` without `b64` (long mixed base64 strings,
too many hashes and tokens that are not secrets) and `conn` (credentialed connection strings).

Person names are out of scope here by design; Level 1 adds them.
"""

import hashlib
import re


def _s(a, b, label, tag):
    return {"start": a, "end": b, "label": label, "score": None, "src": "l0:" + tag}


# ---- validators


def luhn(digits: str) -> bool:
    d = [int(c) for c in digits]
    t = 0
    for i, x in enumerate(reversed(d)):
        if i % 2:
            x *= 2
            x = x - 9 if x > 9 else x
        t += x
    return t % 10 == 0


# A digit run right after a timestamp-like key ("ts=", "epoch_ms:") is a time, not a card.
_TS_CTX = re.compile(r"(?i)(?:\bts\w*|_ms|_ns|\bms|\bns|epoch\w*|time\w*|at|nanos?|millis?|unix)[\s\"':=]*$")


def _iin_ok(d: str) -> bool:
    """Known card issuer prefixes (Visa, Mastercard, Amex, Discover, Diners, JCB)."""
    p2, p4 = int(d[:2]), int(d[:4])
    return (
        d[0] == "4"
        or 51 <= p2 <= 55
        or 2221 <= p4 <= 2720
        or p2 in (34, 37, 65, 36, 38, 39, 35)
        or d[:3] in ("300", "301", "302", "303", "304", "305")
        or d[:4] == "6011"
    )


def iban_ok(s: str) -> bool:
    c = re.sub(r"[\s.\-]", "", s).upper()
    if not 15 <= len(c) <= 34 or not c.isalnum() or not c[:2].isalpha() or not c[2:4].isdigit():
        return False
    r = c[4:] + c[:4]
    try:
        return int("".join(str(int(ch, 36)) for ch in r)) % 97 == 1
    except ValueError:
        return False


def ssn_us_ok(s: str) -> bool:
    a, g, n = s.split("-")
    return a not in ("000", "666") and not a.startswith("9") and g != "00" and n != "0000"


def pers_se_ok(s: str) -> bool:
    """Swedish personnummer: valid month and day, Luhn over the last ten digits."""
    d = re.sub(r"\D", "", s)
    d = d[-10:]
    if len(d) != 10:
        return False
    mm, dd = int(d[2:4]), int(d[4:6])
    return 1 <= mm <= 12 and 1 <= dd <= 31 and luhn(d)


def bsn_ok(d: str) -> bool:
    """Dutch BSN: the 11-proof."""
    if len(d) != 9 or d == "0" * 9:
        return False
    w = [9, 8, 7, 6, 5, 4, 3, 2, -1]
    return sum(int(c) * k for c, k in zip(d, w, strict=False)) % 11 == 0


def dni_ok(s: str) -> bool:
    """Spanish DNI: the control letter."""
    return "TRWAGMYFPDXBNJZSQVHLCKE"[int(s[:8]) % 23] == s[8].upper()


def pesel_ok(d: str) -> bool:
    """Polish PESEL: the weighted check digit."""
    if len(d) != 11:
        return False
    w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
    return (10 - sum(int(c) * k for c, k in zip(d, w, strict=False)) % 10) % 10 == int(d[10])


def cf_ok(s: str) -> bool:
    """Italian codice fiscale: the control character."""
    s = s.upper()
    odd = {
        **dict(zip("0123456789", [1, 0, 5, 7, 9, 13, 15, 17, 19, 21], strict=False)),
        **dict(
            zip(
                "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
                [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23],
                strict=False,
            )
        ),
    }
    even = {
        **{c: i for i, c in enumerate("0123456789")},
        **{c: i for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ")},
    }
    t = sum(odd[c] if i % 2 == 0 else even[c] for i, c in enumerate(s[:15]))
    return "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[t % 26] == s[15]


B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58check_ok(s: str) -> bool:
    """Bitcoin base58check: the double SHA-256 checksum."""
    n = 0
    for c in s:
        if c not in B58:
            return False
        n = n * 58 + B58.index(c)
    raw = n.to_bytes(25, "big") if n < 1 << 200 else None
    if raw is None:
        return False
    return hashlib.sha256(hashlib.sha256(raw[:-4]).digest()).digest()[:4] == raw[-4:]


# ---- patterns

EMAIL = re.compile(
    r"(?<![\w.+-])[A-Za-z0-9][A-Za-z0-9._%+\-]{0,63}@(?:[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}(?![\w-])"
)
IPV4 = re.compile(
    r"(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.]*\d)"
)
IPV6 = re.compile(
    r"(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}(?![0-9A-Fa-f:])"
    r"|(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{1,4}:){1,6}(?::[0-9A-Fa-f]{1,4}){1,5}(?![0-9A-Fa-f:])"
    r"|(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{1,4}:){1,7}:(?![0-9A-Fa-f:])"
)
CARD = re.compile(r"(?<![\d.])\d(?:[ -]?\d){12,18}(?![\d.]|[ -]\d)")
IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?:[ \t\n.\-]?[A-Za-z0-9]{4}){2,7}(?:[ \t\n.\-]?[A-Za-z0-9]{1,4})?\b")
PHONE_E164 = re.compile(r"(?<![\w+])\+\d{1,3}[\s.\-]?(?:\(\d{1,4}\)[\s.\-]?)?\d{1,4}(?:[\s.\-]?\d{2,5}){1,4}(?!\d)")
PHONE_NAT = re.compile(
    r"(?<![\w+.\-/])(?:\(\d{2,5}\)[\s.\-]?\d{3,4}[\s.\-]\d{3,4}"
    r"|\d{2,5}[\s.\-]\d{3,4}[\s.\-]\d{3,4}(?:[\s.\-]\d{2,4})?"
    r"|0\d{1,3}[\s.\-]\d{2}[\s.\-]\d{2}[\s.\-]\d{2}(?:[\s.\-]\d{2})?"
    r"|\d{3,5}\.\d{5,7})(?![\w.\-]*\d)"
)
CREDURI = re.compile(r"\b[a-zA-Z][a-zA-Z0-9+.\-]{1,20}://[^\s/:@'\"<>]*:[^\s/@'\"<>]+@[^\s'\"<>]+")
JDBCQ = re.compile(
    r"\b[a-zA-Z][a-zA-Z0-9+.\-:]{1,30}://[^\s'\"<>]*[?&;](?:user|username|uid)=[^\s&;'\"<>]+[&;](?:password|pwd)=[^\s&;'\"<>]+"
)
PWD = re.compile(r"(?i)\b(?:password|passwd|pwd|passphrase|secret)\s*[=:]\s*[\"']?([^\s\"',;&<>]{6,})")
KEYCUE = re.compile(
    r"(?i)\b(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|auth[_-]?token|token|bearer|client[_-]?secret|x-api-key)\b"
    r"[\"']?\s*[=:]\s*[\"']?([A-Za-z0-9_\-+/=.]{16,})"
)
PREFIX = re.compile(
    r"\b(?:AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}"
    r"|xox[abprs]-[A-Za-z0-9-]{10,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9_\-]{20,}|AIza[0-9A-Za-z_\-]{35}"
    r"|glpat-[A-Za-z0-9_\-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\$2[aby]\$\d\d\$[./A-Za-z0-9]{50,})"
)
B64 = re.compile(
    r"(?<![A-Za-z0-9+/=_-])(?=[A-Za-z0-9+/_=-]*[A-Z])(?=[A-Za-z0-9+/_=-]*[a-z])(?=[A-Za-z0-9+/_=-]*\d)"
    r"[A-Za-z0-9+/_-]{40,}={0,2}(?![A-Za-z0-9+/=_-])"
)
HEXKEY = re.compile(r"(?<![0-9A-Za-z])[0-9a-f]{40,64}(?![0-9A-Za-z])")
WALLET_ETH = re.compile(r"\b0x[0-9a-fA-F]{40}\b")
WALLET_BTC = re.compile(r"\b[13][1-9A-HJ-NP-Za-km-z]{25,34}\b")
WALLET_BECH = re.compile(r"\bbc1[ac-hj-np-z02-9]{25,60}\b")
SSN_US = re.compile(r"(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])")
PERS_SE = re.compile(r"(?<![\d-])\d{6}[-+]\d{4}(?![\d-])")
DNI = re.compile(r"(?<![\w])\d{8}[A-Za-z](?![\w])")
CF = re.compile(r"(?<![\w])[A-Za-z]{6}\d{2}[A-Za-z]\d{2}[A-Za-z]\d{3}[A-Za-z](?![\w])")
NINE = re.compile(r"(?<![\d-])\d{9}(?![\d-])")
ELEVEN = re.compile(r"(?<![\d-])\d{11}(?![\d-])")
# A date of birth is only reported right after a birth cue, in any of the listed languages.
DOB_CUE = re.compile(
    r"(?i)(?:\bdob\b|date of birth|birth ?date|birthday|\bborn\b|\bb\.\s*|geboren|geburtsdatum|naissance|n[ée]e? le"
    r"|nacimiento|nascimento|geboortedatum|data di nascita)[^\n]{0,25}?"
)
DATE = re.compile(
    r"\b(?:\d{1,2}[./\-]\d{1,2}[./\-](?:19|20)\d{2}|(?:19|20)\d{2}[./\-]\d{1,2}[./\-]\d{1,2}|(?:19|20)\d{6}"
    r"|\d{1,2}\.? (?:[A-Za-zÀ-ÿ]{3,10})\.? (?:19|20)\d{2}|(?:[A-Za-z]{3,9}) \d{1,2},? (?:19|20)\d{2})\b"
)
IDCUE = [
    (
        re.compile(
            r"(?i)\b(?:ssn|social security(?: number)?|national (?:id|insurance|identity)(?: number)?|nin|bsn"
            r"|burgerservicenummer|pesel|personnummer|dni|nif|nie|insee|rrn|aadhaar|id card(?: number)?)\b"
            r"[\s\"']*[:=#]?[\s\"']*([A-Z0-9][A-Z0-9 .\-/]{5,20}[A-Z0-9])"
        ),
        "NATIONAL_ID",
    ),
    (
        re.compile(
            r"(?i)\b(?:tax[ _-]?id|tin|vat(?: number| id)?|steuer-?id|codice fiscale|ein)\b"
            r"[\s\"']*[:=#]?[\s\"']*([A-Z0-9][A-Z0-9 .\-/]{5,20}[A-Z0-9])"
        ),
        "TAX_ID",
    ),
    (re.compile(r"(?i)\bpassport(?: (?:no|number|nr))?\b[\s\"']*[:=#.]?[\s\"']*([A-Z0-9]{6,12})"), "PASSPORT"),
    (
        re.compile(
            r"(?i)\b(?:bank account|account number|acct(?:ount)? ?(?:no|nr|num)|konto(?:nummer)?|sort code)\b"
            r"[\s\"']*[:=#.]?[\s\"']*([0-9][0-9 .\-/]{5,24}[0-9])"
        ),
        "BANK_ACCOUNT",
    ),
]

# Detectors with dev precision >= 0.6. hexkey (0.25) and idcue (0.25) were dropped.
FROZEN = frozenset(
    {"email", "conn", "ipv4", "ipv6", "card", "iban", "phone", "wallet", "pwd", "keycue", "prefix", "b64", "dob", "ssn"}
)

# What Level 0 runs: FROZEN without base64 strings and connection strings.
LEVEL0_DETECTORS = FROZEN - {"b64", "conn"}

# A base64 run right after one of these keys is a hash, nonce or id, not a secret.
_B64_DECOY = re.compile(
    r"(?i)(?:sha\d{1,3}-|integrity|checksum|digest|hash|nonce|verifier|state|signature|etag|sri|resolved|commit"
    r"|trace|span|request[_-]?id)[\w\"':= \-]{0,12}$"
)


def detect(text: str, enabled=None) -> list:
    """Run the enabled detectors over `text` (default: all of FROZEN) and return deduplicated spans."""
    out = []
    enabled = FROZEN if enabled is None else enabled

    def on(k):
        return k in enabled

    if on("email"):
        for m in EMAIL.finditer(text):
            out.append(_s(m.start(), m.end(), "EMAIL", "email"))
    if on("conn"):
        for m in CREDURI.finditer(text):
            out.append(_s(m.start(), m.end(), "CONNECTION_STRING", "conn"))
        for m in JDBCQ.finditer(text):
            out.append(_s(m.start(), m.end(), "CONNECTION_STRING", "conn"))
    if on("ipv4"):
        for m in IPV4.finditer(text):
            out.append(_s(m.start(), m.end(), "IP_ADDRESS", "ipv4"))
    if on("ipv6"):
        for m in IPV6.finditer(text):
            # Link-local and loopback addresses identify no one.
            if m.group().count(":") >= 3 and not m.group().lower().startswith(("fe80", "::1")):
                out.append(_s(m.start(), m.end(), "IP_ADDRESS", "ipv6"))
    if on("card"):
        for m in CARD.finditer(text):
            d = re.sub(r"\D", "", m.group())
            sep = bool(re.search(r"[ -]", m.group()))
            if not (13 <= len(d) <= 19 and luhn(d)):
                continue
            # An ungrouped digit run needs a card length and a known issuer prefix.
            if not sep and (len(d) not in (15, 16) or not _iin_ok(d)):
                continue
            # A grouped run needs a known issuer prefix or the 4-4-4-4 card grouping.
            if sep and not _iin_ok(d) and not re.search(r"\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{3,4}", m.group()):
                continue
            if _TS_CTX.search(text[max(0, m.start() - 24) : m.start()]):
                continue
            out.append(_s(m.start(), m.end(), "CREDIT_CARD", "card"))
    if on("iban"):
        for m in IBAN.finditer(text):
            if iban_ok(m.group()):
                out.append(_s(m.start(), m.end(), "IBAN", "iban"))
    if on("phone"):
        for m in PHONE_E164.finditer(text):
            d = re.sub(r"\D", "", m.group())
            if 8 <= len(d) <= 15:
                out.append(_s(m.start(), m.end(), "PHONE", "phone"))
        for m in PHONE_NAT.finditer(text):
            d = re.sub(r"\D", "", m.group())
            # A national-format run that passes Luhn is more likely a card or an id than a phone.
            if 9 <= len(d) <= 13 and not luhn(d):
                out.append(_s(m.start(), m.end(), "PHONE", "phone"))
    if on("wallet"):
        for m in WALLET_ETH.finditer(text):
            out.append(_s(m.start(), m.end(), "CRYPTO_WALLET", "wallet"))
        for m in WALLET_BTC.finditer(text):
            if b58check_ok(m.group()):
                out.append(_s(m.start(), m.end(), "CRYPTO_WALLET", "wallet"))
        for m in WALLET_BECH.finditer(text):
            out.append(_s(m.start(), m.end(), "CRYPTO_WALLET", "wallet"))
    if on("pwd"):
        for m in PWD.finditer(text):
            out.append(_s(m.start(1), m.end(1), "PASSWORD", "pwd"))
    if on("keycue"):
        for m in KEYCUE.finditer(text):
            out.append(_s(m.start(1), m.end(1), "API_KEY", "keycue"))
    if on("prefix"):
        for m in PREFIX.finditer(text):
            # Documentation placeholders (AKIA...EXAMPLE, sk-XXXX...) are not keys.
            if m.group().upper().endswith("EXAMPLE") or "XXXX" in m.group().upper():
                continue
            out.append(_s(m.start(), m.end(), "API_KEY", "prefix"))
    if on("b64"):
        for m in B64.finditer(text):
            pre = text[max(0, m.start() - 40) : m.start()]
            if _B64_DECOY.search(pre):
                continue
            out.append(_s(m.start(), m.end(), "API_KEY", "b64"))
    if on("hexkey"):
        for m in HEXKEY.finditer(text):
            out.append(_s(m.start(), m.end(), "API_KEY", "hexkey"))
    if on("dob"):
        for c in DOB_CUE.finditer(text):
            m = DATE.search(text, c.end(), c.end() + 30)
            if m and m.start() - c.end() <= 3:
                out.append(_s(m.start(), m.end(), "DATE_OF_BIRTH", "dob"))
    if on("ssn"):
        for m in SSN_US.finditer(text):
            if ssn_us_ok(m.group()):
                out.append(_s(m.start(), m.end(), "SSN_EQUIVALENT", "ssn"))
        for m in PERS_SE.finditer(text):
            if pers_se_ok(m.group()):
                out.append(_s(m.start(), m.end(), "NATIONAL_ID", "ssn"))
        for m in DNI.finditer(text):
            if dni_ok(m.group()):
                out.append(_s(m.start(), m.end(), "NATIONAL_ID", "ssn"))
        for m in CF.finditer(text):
            try:
                if cf_ok(m.group()):
                    out.append(_s(m.start(), m.end(), "TAX_ID", "ssn"))
            except KeyError:
                pass
        for m in NINE.finditer(text):
            if bsn_ok(m.group()):
                out.append(_s(m.start(), m.end(), "NATIONAL_ID", "ssn"))
        for m in ELEVEN.finditer(text):
            if pesel_ok(m.group()):
                out.append(_s(m.start(), m.end(), "NATIONAL_ID", "ssn"))
    if on("idcue"):
        for rx, lab in IDCUE:
            for m in rx.finditer(text):
                out.append(_s(m.start(1), m.end(1), lab, "idcue"))
    return _dedupe(out)


def _dedupe(spans):
    """Drop a span that starts inside the previous kept one. When the two share a label and the
    later one reaches further, the kept span is extended to cover both."""
    spans = sorted(spans, key=lambda s: (s["start"], -(s["end"] - s["start"])))
    res = []
    for s in spans:
        if res and s["start"] < res[-1]["end"]:
            if s["end"] > res[-1]["end"] and s["label"] == res[-1]["label"]:
                res[-1] = {**res[-1], "end": s["end"]}
            continue
        res.append(s)
    return res
