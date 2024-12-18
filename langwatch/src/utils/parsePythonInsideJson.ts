import * as ohm from "ohm-js";

const grammar = ohm.grammar(`
  PyRepr {
    Expression = ObjectExpr | Array | String | Number | Boolean | null

    ObjectExpr = ClassExpr | DictExpr

    ClassExpr = identifier "(" ListOf<KeyValue, ","> ")"
    DictExpr = "{" ListOf<DictPair, ","> "}"

    KeyValue = identifier "=" Expression
    DictPair = (String | identifier) ":" Expression

    Array = "[" ListOf<Expression, ","> "]"

    String = "'" (~"'" any)* "'" | "\\"" (~"\\"" any)* "\\""

    Number = float | integer
    float = "-"? digit+ "." digit+ ("e" "-"? digit+)?
    integer = "-"? digit+

    Boolean = "True" | "False"

    null = "None"

    identifier = letter (alnum | "_")*
  }
`);

const semantics = grammar.createSemantics().addOperation("toJSON", {
  Expression: (e) => e.toJSON(),
  ObjectExpr: (e) => e.toJSON(),
  ClassExpr: (id, _1, kvs, _2) => ({
    [id.sourceString]: Object.fromEntries(kvs.toJSON()),
  }),
  DictExpr: (_1, pairs, _2) => Object.fromEntries(pairs.toJSON()),
  KeyValue: (id, _, val) => [id.sourceString, val.toJSON()],
  DictPair: (key, _, val) => [key.toJSON(), val.toJSON()],
  Array: (_, elements, __) => elements.toJSON(),
  String: (q1, chars, q2) => chars.sourceString,
  Number: (n) => n.toJSON(),
  float: function (neg, whole, dot, fract, e, eneg, exp) {
    return parseFloat(this.sourceString);
  },
  integer: function (neg, digits) {
    return parseInt(this.sourceString, 10);
  },
  Boolean: (b) => b.sourceString === "True",
  null: (_) => null,
  identifier: (first, rest) => first.sourceString + rest.sourceString,

  // Add these handlers for ListOf
  NonemptyListOf: (first, _, rest) => [first.toJSON(), ...rest.toJSON()],
  EmptyListOf: () => [],
  _iter: (...children) => children.map((child) => child.toJSON()),
});

export const isPythonRepr = (input: string) =>
  /^[A-Z][A-Za-z0-9_]*\(/.test(input);

export const parsePythonInsideJson = <T extends object>(item: T): T => {
  if (typeof item === "object" && Array.isArray(item)) {
    return item.map((item) => parsePythonInsideJson(item)) as T;
  } else if (typeof item === "object" && item !== null) {
    return Object.fromEntries(
      Object.entries(item).map(([key, value]) => [
        key,
        parsePythonInsideJson(value),
      ])
    ) as T;
  } else if (typeof item === "string" && isPythonRepr(item)) {
    const match = grammar.match(item);
    if (match.succeeded()) {
      const result = semantics(match).toJSON();
      return result;
    }
  }
  return item;
};
