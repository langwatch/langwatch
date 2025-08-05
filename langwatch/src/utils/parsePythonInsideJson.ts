import * as ohm from "ohm-js";

const grammar = ohm.grammar(`
  PyRepr {
    Expression = null | Boolean | ObjectExpr | Array | String | UUID | Number | AngleBracket

    ObjectExpr = ClassExpr | DictExpr

    ClassExpr = identifier "(" ListOf<ArgValue, ","> ")"
    DictExpr = "{" ListOf<DictPair, ","> "}"

    ArgValue = KeyValue | Expression

    KeyValue = identifier ("=" | ":") Expression
    DictPair = (String | identifier) ":" Expression

    Array = "[" ListOf<Expression, ","> "]"

    String = "'" (~"'" any)* "'" | "\\"" (~"\\"" any)* "\\""

    Number = float | integer
    float = "-"? digit+ "." digit+ ("e" "-"? digit+)?
    integer = "-"? digit+

    Boolean = "True" | "False"

    null = "None"

    AngleBracket = "<" (~">" any)* ">"

    UUID = letter alnum alnum+
        | digit+ letter+ alnum+
        | alnum+ "-" alnum+

    identifier = ~("None" | "True" | "False") letter (alnum | "_")*
  }
`);

const semantics = grammar.createSemantics().addOperation("toJSON", {
  Expression: (e) => e.toJSON(),
  ObjectExpr: (e) => e.toJSON(),
  ClassExpr: (id, _1, args, _2) => {
    let argIndex = 0;
    const processedArgs = args.toJSON().map((arg: any) => {
      if (Array.isArray(arg)) {
        // Named argument
        return arg;
      } else {
        // Unnamed argument
        return [`arg${argIndex++}`, arg];
      }
    });
    return {
      [id.sourceString]: Object.fromEntries(processedArgs),
    };
  },
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
  AngleBracket: (_1, content, _2) => `<${content.sourceString}>`,
  UUID: (uuid, b, c) => uuid.sourceString + b.sourceString + c.sourceString,
  identifier: (first, rest) => first.sourceString + rest.sourceString,

  // Add these handlers for ListOf
  NonemptyListOf: (first, _, rest) => [first.toJSON(), ...rest.toJSON()],
  EmptyListOf: () => [],
  _iter: (...children) => children.map((child) => child.toJSON()),

  // New handler for ArgValue
  ArgValue: (arg) => arg.toJSON(),
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
      let result = semantics(match).toJSON();
      if (typeof result === "object" && !Array.isArray(result)) {
        result = Object.fromEntries(
          Object.entries(result).map(([key, value]) => [
            key,
            typeof value === "object" &&
            "arg0" in (value as any) &&
            Object.keys(value as any).length === 1
              ? (value as any).arg0
              : value,
          ])
        );
      }
      return result;
    }
  }
  return item;
};
