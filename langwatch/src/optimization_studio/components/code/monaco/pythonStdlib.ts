/**
 * Curated catalogue of Python standard-library identifiers used to drive
 * Monaco autocomplete inside the workflow code editor.
 *
 * Workflow code nodes execute against a sandboxed Python interpreter that only
 * exposes the standard library (plus the injected `secrets` namespace and the
 * node's typed inputs). The data here mirrors that surface so autocomplete
 * never suggests something the runtime cannot resolve.
 */

export interface PyMember {
  name: string;
  kind: "function" | "class" | "constant" | "method" | "property";
  signature?: string;
  doc?: string;
}

export interface PyModule {
  name: string;
  doc: string;
  members: PyMember[];
}

export const PYTHON_BUILTINS: PyMember[] = [
  { name: "abs", kind: "function", signature: "abs(x)", doc: "Return the absolute value of a number." },
  { name: "all", kind: "function", signature: "all(iterable)", doc: "Return True if all elements are truthy." },
  { name: "any", kind: "function", signature: "any(iterable)", doc: "Return True if any element is truthy." },
  { name: "ascii", kind: "function", signature: "ascii(object)", doc: "Return an ASCII-only repr of object." },
  { name: "bin", kind: "function", signature: "bin(x)", doc: "Convert an integer to a binary string." },
  { name: "bool", kind: "class", signature: "bool(x=False)", doc: "Truth value testing." },
  { name: "bytearray", kind: "class", signature: "bytearray(...)", doc: "Mutable sequence of bytes." },
  { name: "bytes", kind: "class", signature: "bytes(...)", doc: "Immutable sequence of bytes." },
  { name: "callable", kind: "function", signature: "callable(object)", doc: "Return True if object is callable." },
  { name: "chr", kind: "function", signature: "chr(i)", doc: "Return the character at code point i." },
  { name: "classmethod", kind: "function", signature: "@classmethod", doc: "Class method decorator." },
  { name: "complex", kind: "class", signature: "complex(real, imag)", doc: "Complex number." },
  { name: "dict", kind: "class", signature: "dict(**kwargs)", doc: "Mapping container." },
  { name: "dir", kind: "function", signature: "dir(object)", doc: "List attributes of object." },
  { name: "divmod", kind: "function", signature: "divmod(a, b)", doc: "Return (a // b, a % b)." },
  { name: "enumerate", kind: "function", signature: "enumerate(iterable, start=0)", doc: "Index/value pairs." },
  { name: "eval", kind: "function", signature: "eval(expression)", doc: "Evaluate a Python expression." },
  { name: "exec", kind: "function", signature: "exec(object)", doc: "Execute Python code dynamically." },
  { name: "filter", kind: "function", signature: "filter(function, iterable)", doc: "Filter elements." },
  { name: "float", kind: "class", signature: "float(x=0.0)", doc: "Floating point number." },
  { name: "format", kind: "function", signature: "format(value, format_spec='')", doc: "Format a value." },
  { name: "frozenset", kind: "class", signature: "frozenset(iterable)", doc: "Immutable set." },
  { name: "getattr", kind: "function", signature: "getattr(object, name, default=...)", doc: "Get attribute." },
  { name: "hasattr", kind: "function", signature: "hasattr(object, name)", doc: "Check for attribute." },
  { name: "hash", kind: "function", signature: "hash(object)", doc: "Return hash of object." },
  { name: "hex", kind: "function", signature: "hex(x)", doc: "Convert an integer to a hex string." },
  { name: "id", kind: "function", signature: "id(object)", doc: "Return the identity of object." },
  { name: "input", kind: "function", signature: "input(prompt='')", doc: "Read a line from stdin." },
  { name: "int", kind: "class", signature: "int(x=0)", doc: "Integer number." },
  { name: "isinstance", kind: "function", signature: "isinstance(obj, class_or_tuple)", doc: "Instance check." },
  { name: "issubclass", kind: "function", signature: "issubclass(cls, class_or_tuple)", doc: "Subclass check." },
  { name: "iter", kind: "function", signature: "iter(object)", doc: "Return an iterator." },
  { name: "len", kind: "function", signature: "len(s)", doc: "Return the length of an object." },
  { name: "list", kind: "class", signature: "list(iterable=())", doc: "Mutable sequence." },
  { name: "locals", kind: "function", signature: "locals()", doc: "Local variable dict." },
  { name: "map", kind: "function", signature: "map(function, iterable)", doc: "Map function over iterable." },
  { name: "max", kind: "function", signature: "max(iterable, *, key=None, default=...)", doc: "Largest item." },
  { name: "memoryview", kind: "class", signature: "memoryview(object)", doc: "Memory view of buffer." },
  { name: "min", kind: "function", signature: "min(iterable, *, key=None, default=...)", doc: "Smallest item." },
  { name: "next", kind: "function", signature: "next(iterator, default=...)", doc: "Next item from iterator." },
  { name: "object", kind: "class", signature: "object()", doc: "Base class for all objects." },
  { name: "oct", kind: "function", signature: "oct(x)", doc: "Convert an integer to an octal string." },
  { name: "open", kind: "function", signature: "open(file, mode='r', ...)", doc: "Open a file." },
  { name: "ord", kind: "function", signature: "ord(c)", doc: "Return code point of character." },
  { name: "pow", kind: "function", signature: "pow(base, exp, mod=None)", doc: "Power." },
  { name: "print", kind: "function", signature: "print(*objects, sep=' ', end='\\n')", doc: "Print to stdout." },
  { name: "property", kind: "function", signature: "@property", doc: "Property decorator." },
  { name: "range", kind: "class", signature: "range(stop) | range(start, stop[, step])", doc: "Range of integers." },
  { name: "repr", kind: "function", signature: "repr(object)", doc: "Printable representation." },
  { name: "reversed", kind: "function", signature: "reversed(seq)", doc: "Reverse iterator." },
  { name: "round", kind: "function", signature: "round(number, ndigits=None)", doc: "Round to ndigits." },
  { name: "set", kind: "class", signature: "set(iterable=())", doc: "Mutable set." },
  { name: "setattr", kind: "function", signature: "setattr(object, name, value)", doc: "Set attribute." },
  { name: "slice", kind: "class", signature: "slice(stop) | slice(start, stop[, step])", doc: "Slice object." },
  { name: "sorted", kind: "function", signature: "sorted(iterable, *, key=None, reverse=False)", doc: "Sorted list." },
  { name: "staticmethod", kind: "function", signature: "@staticmethod", doc: "Static method decorator." },
  { name: "str", kind: "class", signature: "str(object='')", doc: "Text string." },
  { name: "sum", kind: "function", signature: "sum(iterable, start=0)", doc: "Sum of iterable." },
  { name: "super", kind: "function", signature: "super()", doc: "Proxy for parent class." },
  { name: "tuple", kind: "class", signature: "tuple(iterable=())", doc: "Immutable sequence." },
  { name: "type", kind: "class", signature: "type(object) | type(name, bases, dict)", doc: "Type of object." },
  { name: "vars", kind: "function", signature: "vars(object=...)", doc: "Return __dict__ of object." },
  { name: "zip", kind: "function", signature: "zip(*iterables, strict=False)", doc: "Aggregate iterables." },
  { name: "True", kind: "constant", doc: "Boolean true." },
  { name: "False", kind: "constant", doc: "Boolean false." },
  { name: "None", kind: "constant", doc: "Null value." },
];

const fn = (name: string, signature: string, doc: string): PyMember => ({
  name,
  kind: "function",
  signature,
  doc,
});

const cls = (name: string, signature: string, doc: string): PyMember => ({
  name,
  kind: "class",
  signature,
  doc,
});

const con = (name: string, doc: string): PyMember => ({
  name,
  kind: "constant",
  doc,
});

/**
 * Subset of Python stdlib modules that are commonly used inside workflow code
 * nodes. Each lists the most frequently accessed top-level members so
 * `module.<member>` autocomplete is useful without the bundle exploding.
 */
export const PYTHON_STDLIB_MODULES: PyModule[] = [
  {
    name: "math",
    doc: "Mathematical functions.",
    members: [
      fn("ceil", "ceil(x)", "Smallest int >= x."),
      fn("floor", "floor(x)", "Largest int <= x."),
      fn("sqrt", "sqrt(x)", "Square root of x."),
      fn("log", "log(x, base=e)", "Logarithm of x."),
      fn("log2", "log2(x)", "Base-2 log of x."),
      fn("log10", "log10(x)", "Base-10 log of x."),
      fn("exp", "exp(x)", "e**x."),
      fn("pow", "pow(x, y)", "x**y."),
      fn("sin", "sin(x)", "Sine of x (radians)."),
      fn("cos", "cos(x)", "Cosine of x (radians)."),
      fn("tan", "tan(x)", "Tangent of x (radians)."),
      fn("atan2", "atan2(y, x)", "arctan(y/x), full quadrant."),
      fn("isnan", "isnan(x)", "True if x is NaN."),
      fn("isinf", "isinf(x)", "True if x is infinite."),
      fn("isclose", "isclose(a, b, *, rel_tol=1e-9, abs_tol=0.0)", "Approximate equality."),
      fn("gcd", "gcd(*integers)", "Greatest common divisor."),
      fn("lcm", "lcm(*integers)", "Least common multiple."),
      con("pi", "Mathematical constant π."),
      con("e", "Mathematical constant e."),
      con("inf", "Floating-point infinity."),
      con("nan", "Floating-point NaN."),
      con("tau", "Mathematical constant τ (2π)."),
    ],
  },
  {
    name: "json",
    doc: "JSON encoder and decoder.",
    members: [
      fn("dumps", "dumps(obj, *, indent=None, sort_keys=False, default=None)", "Serialize to JSON string."),
      fn("loads", "loads(s)", "Parse JSON string."),
      fn("dump", "dump(obj, fp, *, indent=None)", "Serialize to file."),
      fn("load", "load(fp)", "Parse JSON from file."),
      cls("JSONDecodeError", "JSONDecodeError(msg, doc, pos)", "Raised on parse failure."),
    ],
  },
  {
    name: "re",
    doc: "Regular expressions.",
    members: [
      fn("match", "match(pattern, string, flags=0)", "Match at the start of string."),
      fn("search", "search(pattern, string, flags=0)", "Find first match anywhere."),
      fn("findall", "findall(pattern, string, flags=0)", "All non-overlapping matches."),
      fn("finditer", "finditer(pattern, string, flags=0)", "Iterator over matches."),
      fn("sub", "sub(pattern, repl, string, count=0, flags=0)", "Replace matches."),
      fn("subn", "subn(pattern, repl, string, count=0, flags=0)", "Replace, return count."),
      fn("split", "split(pattern, string, maxsplit=0, flags=0)", "Split by pattern."),
      fn("compile", "compile(pattern, flags=0)", "Compile a Pattern object."),
      fn("escape", "escape(pattern)", "Escape regex metacharacters."),
      con("IGNORECASE", "Case-insensitive matching flag."),
      con("MULTILINE", "Multi-line ^/$ matching flag."),
      con("DOTALL", "Dot matches newline flag."),
      con("VERBOSE", "Verbose pattern flag."),
    ],
  },
  {
    name: "datetime",
    doc: "Date and time types.",
    members: [
      cls("datetime", "datetime(year, month, day, ...)", "Date + time + tz."),
      cls("date", "date(year, month, day)", "Calendar date."),
      cls("time", "time(hour=0, minute=0, second=0, ...)", "Time of day."),
      cls("timedelta", "timedelta(days=0, seconds=0, ...)", "Time interval."),
      cls("timezone", "timezone(offset)", "Fixed-offset timezone."),
    ],
  },
  {
    name: "os",
    doc: "Operating system interfaces (sandbox-restricted).",
    members: [
      fn("getcwd", "getcwd()", "Current working directory."),
      fn("getenv", "getenv(key, default=None)", "Read env var."),
      fn("listdir", "listdir(path='.')", "List directory entries."),
      con("environ", "Mapping of env vars."),
      con("path", "Submodule with path manipulation utilities."),
      con("sep", "Path separator for the platform."),
      con("linesep", "Line separator for the platform."),
    ],
  },
  {
    name: "sys",
    doc: "System-specific parameters.",
    members: [
      con("argv", "Command-line arguments."),
      con("path", "Module search path."),
      con("platform", "Platform identifier."),
      con("version", "Python version string."),
      con("version_info", "Named tuple with version parts."),
      con("maxsize", "Largest representable size_t."),
      fn("exit", "exit(code=0)", "Exit interpreter."),
    ],
  },
  {
    name: "collections",
    doc: "Specialized container datatypes.",
    members: [
      cls("OrderedDict", "OrderedDict(...)", "Dict that remembers insertion order."),
      cls("defaultdict", "defaultdict(default_factory, ...)", "Dict with default factory."),
      cls("Counter", "Counter(iterable=None)", "Count hashable objects."),
      cls("deque", "deque(iterable=(), maxlen=None)", "Double-ended queue."),
      cls("namedtuple", "namedtuple(typename, field_names)", "Named tuple factory."),
      cls("ChainMap", "ChainMap(*maps)", "View of multiple mappings."),
    ],
  },
  {
    name: "itertools",
    doc: "Iterator algebra.",
    members: [
      fn("chain", "chain(*iterables)", "Chain multiple iterables."),
      fn("count", "count(start=0, step=1)", "Infinite counter."),
      fn("cycle", "cycle(iterable)", "Cycle indefinitely."),
      fn("repeat", "repeat(object, times=None)", "Repeat an object."),
      fn("islice", "islice(iterable, stop) | islice(iterable, start, stop, step)", "Slice an iterator."),
      fn("groupby", "groupby(iterable, key=None)", "Group consecutive equal items."),
      fn("product", "product(*iterables, repeat=1)", "Cartesian product."),
      fn("permutations", "permutations(iterable, r=None)", "Permutations."),
      fn("combinations", "combinations(iterable, r)", "Combinations."),
      fn("combinations_with_replacement", "combinations_with_replacement(iterable, r)", "With replacement."),
      fn("accumulate", "accumulate(iterable, func=operator.add, *, initial=None)", "Running totals."),
      fn("compress", "compress(data, selectors)", "Filter by selector iterable."),
      fn("dropwhile", "dropwhile(predicate, iterable)", "Drop while true."),
      fn("takewhile", "takewhile(predicate, iterable)", "Take while true."),
      fn("starmap", "starmap(function, iterable)", "Map with unpacked args."),
      fn("tee", "tee(iterable, n=2)", "Split iterator into n."),
      fn("zip_longest", "zip_longest(*iterables, fillvalue=None)", "Zip filling shorter."),
    ],
  },
  {
    name: "functools",
    doc: "Higher-order functions and operations on callables.",
    members: [
      fn("reduce", "reduce(function, iterable, initializer=...)", "Apply function cumulatively."),
      fn("cache", "@cache", "Unbounded function-result cache."),
      fn("lru_cache", "@lru_cache(maxsize=128, typed=False)", "Least-recently-used cache."),
      fn("partial", "partial(func, *args, **kwargs)", "Bind arguments."),
      fn("wraps", "@wraps(wrapped)", "Decorator helper."),
      cls("partialmethod", "partialmethod(func, *args, **kwargs)", "Method version of partial."),
    ],
  },
  {
    name: "random",
    doc: "Pseudo-random number generation.",
    members: [
      fn("random", "random()", "Float in [0.0, 1.0)."),
      fn("uniform", "uniform(a, b)", "Float in [a, b]."),
      fn("randint", "randint(a, b)", "Int in [a, b]."),
      fn("randrange", "randrange(stop) | randrange(start, stop[, step])", "Random range."),
      fn("choice", "choice(seq)", "Random element of seq."),
      fn("choices", "choices(population, weights=None, *, k=1)", "k random selections."),
      fn("sample", "sample(population, k)", "k unique random elements."),
      fn("shuffle", "shuffle(x)", "Shuffle list in place."),
      fn("seed", "seed(a=None)", "Initialize RNG state."),
      fn("gauss", "gauss(mu=0.0, sigma=1.0)", "Gaussian distribution."),
    ],
  },
  {
    name: "string",
    doc: "Common string operations.",
    members: [
      con("ascii_letters", "All ASCII letters."),
      con("ascii_lowercase", "ASCII lowercase letters."),
      con("ascii_uppercase", "ASCII uppercase letters."),
      con("digits", "Decimal digits 0-9."),
      con("hexdigits", "Hex digits 0-f."),
      con("printable", "All printable ASCII."),
      con("punctuation", "ASCII punctuation."),
      con("whitespace", "ASCII whitespace."),
      cls("Template", "Template(template)", "String template with $name placeholders."),
      cls("Formatter", "Formatter()", "Custom string formatter."),
    ],
  },
  {
    name: "base64",
    doc: "RFC 3548 Base16, Base32, Base64 codecs.",
    members: [
      fn("b64encode", "b64encode(s, altchars=None)", "Standard Base64 encode."),
      fn("b64decode", "b64decode(s, altchars=None, validate=False)", "Standard Base64 decode."),
      fn("urlsafe_b64encode", "urlsafe_b64encode(s)", "URL-safe Base64 encode."),
      fn("urlsafe_b64decode", "urlsafe_b64decode(s)", "URL-safe Base64 decode."),
      fn("b32encode", "b32encode(s)", "Base32 encode."),
      fn("b32decode", "b32decode(s, casefold=False, map01=None)", "Base32 decode."),
      fn("b16encode", "b16encode(s)", "Base16 encode."),
      fn("b16decode", "b16decode(s, casefold=False)", "Base16 decode."),
    ],
  },
  {
    name: "hashlib",
    doc: "Secure hash and message digest algorithms.",
    members: [
      fn("md5", "md5(data=b'')", "MD5 hash (legacy use only)."),
      fn("sha1", "sha1(data=b'')", "SHA-1 hash."),
      fn("sha224", "sha224(data=b'')", "SHA-224 hash."),
      fn("sha256", "sha256(data=b'')", "SHA-256 hash."),
      fn("sha384", "sha384(data=b'')", "SHA-384 hash."),
      fn("sha512", "sha512(data=b'')", "SHA-512 hash."),
      fn("blake2b", "blake2b(data=b'', *, digest_size=64)", "BLAKE2b hash."),
      fn("blake2s", "blake2s(data=b'', *, digest_size=32)", "BLAKE2s hash."),
      fn("new", "new(name, data=b'')", "Generic hash constructor."),
    ],
  },
  {
    name: "uuid",
    doc: "UUID objects per RFC 4122.",
    members: [
      fn("uuid1", "uuid1(node=None, clock_seq=None)", "Host/time based UUID."),
      fn("uuid3", "uuid3(namespace, name)", "MD5 namespace UUID."),
      fn("uuid4", "uuid4()", "Random UUID."),
      fn("uuid5", "uuid5(namespace, name)", "SHA-1 namespace UUID."),
      cls("UUID", "UUID(hex=None, ...)", "UUID class."),
    ],
  },
  {
    name: "textwrap",
    doc: "Text wrapping and filling.",
    members: [
      fn("wrap", "wrap(text, width=70)", "Wrap text into lines."),
      fn("fill", "fill(text, width=70)", "Wrap and join with newlines."),
      fn("dedent", "dedent(text)", "Remove common leading whitespace."),
      fn("indent", "indent(text, prefix, predicate=None)", "Prefix every line."),
      fn("shorten", "shorten(text, width, *, placeholder='...')", "Truncate text."),
    ],
  },
  {
    name: "statistics",
    doc: "Mathematical statistics functions.",
    members: [
      fn("mean", "mean(data)", "Arithmetic mean."),
      fn("median", "median(data)", "Median of data."),
      fn("median_low", "median_low(data)", "Low median."),
      fn("median_high", "median_high(data)", "High median."),
      fn("mode", "mode(data)", "Most common value."),
      fn("multimode", "multimode(data)", "All most-common values."),
      fn("stdev", "stdev(data, xbar=None)", "Sample standard deviation."),
      fn("pstdev", "pstdev(data, mu=None)", "Population standard deviation."),
      fn("variance", "variance(data, xbar=None)", "Sample variance."),
      fn("pvariance", "pvariance(data, mu=None)", "Population variance."),
      fn("quantiles", "quantiles(data, *, n=4, method='exclusive')", "Cut points."),
    ],
  },
  {
    name: "decimal",
    doc: "Fixed and floating point arithmetic.",
    members: [
      cls("Decimal", "Decimal(value='0')", "Decimal floating-point number."),
      cls("Context", "Context(prec=28, rounding=ROUND_HALF_EVEN, ...)", "Computational context."),
      fn("getcontext", "getcontext()", "Return current context."),
      fn("setcontext", "setcontext(ctx)", "Set current context."),
    ],
  },
  {
    name: "urllib.parse",
    doc: "URL parsing utilities.",
    members: [
      fn("urlparse", "urlparse(url)", "Parse URL into 6-tuple."),
      fn("urlunparse", "urlunparse(parts)", "Re-assemble parsed URL."),
      fn("urlencode", "urlencode(query, doseq=False)", "Encode mapping/sequence to query string."),
      fn("quote", "quote(string, safe='/')", "Percent-encode."),
      fn("quote_plus", "quote_plus(string)", "Percent-encode with spaces as +."),
      fn("unquote", "unquote(string)", "Percent-decode."),
      fn("unquote_plus", "unquote_plus(string)", "Percent-decode with + as space."),
      fn("parse_qs", "parse_qs(qs)", "Parse query string to dict of lists."),
      fn("parse_qsl", "parse_qsl(qs)", "Parse query string to list of pairs."),
    ],
  },
];

export const PYTHON_STDLIB_MODULE_NAMES: string[] = PYTHON_STDLIB_MODULES
  .map((m) => m.name);

export const PYTHON_STDLIB_MODULE_BY_NAME = new Map<string, PyModule>(
  PYTHON_STDLIB_MODULES.map((m) => [m.name, m]),
);

export const PYTHON_BUILTIN_BY_NAME = new Map<string, PyMember>(
  PYTHON_BUILTINS.map((b) => [b.name, b]),
);

/**
 * Python keywords for static suggestion. Not a full grammar — just the words
 * the editor should surface alongside builtins so completion feels complete.
 */
export const PYTHON_KEYWORDS: string[] = [
  "and", "as", "assert", "async", "await",
  "break", "class", "continue", "def", "del",
  "elif", "else", "except", "finally", "for",
  "from", "global", "if", "import", "in",
  "is", "lambda", "match", "nonlocal", "not",
  "or", "pass", "raise", "return", "try",
  "while", "with", "yield",
];
