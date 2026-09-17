export type BrowserDeclaration = {
  readonly id: string;
  readonly pages: readonly string[];
  readonly paths: readonly string[];
  readonly drawers: readonly string[];
  readonly publishes: readonly string[];
  readonly mounts: readonly string[];
};

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type Field = "pages" | "paths" | "drawers" | "publishes" | "mounts";
type Collect<
  Modules extends readonly BrowserDeclaration[],
  Key extends Field,
  Result extends readonly string[] = [],
> = Modules extends readonly [
  infer Head extends BrowserDeclaration,
  ...infer Tail extends readonly BrowserDeclaration[],
]
  ? Collect<Tail, Key, [...Result, ...Head[Key]]>
  : Result;
type Ids<Modules extends readonly BrowserDeclaration[]> = {
  [Index in keyof Modules]: Modules[Index]["id"];
};
type Duplicate<
  Values extends readonly string[],
  Seen extends string = never,
  Result extends string = never,
> = Values extends readonly [infer Head extends string, ...infer Tail extends readonly string[]]
  ? Duplicate<Tail, Seen | Head, Result | (Head extends Seen ? Head : never)>
  : Result;
type Named<Kind extends string, Values extends string> = `duplicate ${Kind} "${Values}"`;
type Widened<Modules extends readonly BrowserDeclaration[]> = number extends Modules["length"]
  ? "module list must be a literal tuple"
  : {
      [Index in keyof Modules]: string extends Modules[Index]["id"]
        ? "module id must be a literal"
        : {
            [Key in Field]: number extends Modules[Index][Key]["length"]
              ? `module "${Modules[Index]["id"]}" ${Key} must be a literal tuple`
              : string extends Modules[Index][Key][number]
                ? `module "${Modules[Index]["id"]}" ${Key} must contain literals`
                : never;
          }[Field];
    }[number];

type ForeignPublications<
  Modules extends readonly BrowserDeclaration[],
  Packages extends Readonly<Record<string, string>>,
> = {
  [Index in keyof Modules]: Exclude<
    Modules[Index]["publishes"][number],
    Packages[Modules[Index]["id"]] | `${Packages[Modules[Index]["id"]]}/${string}`
  > extends infer Address extends string
    ? `module "${Modules[Index]["id"]}" cannot publish "${Address}"`
    : never;
}[number];

type Problems<
  Modules extends readonly BrowserDeclaration[],
  Packages extends Readonly<Record<string, string>>,
> =
  | `unknown module id "${Exclude<Modules[number]["id"], keyof Packages & string>}"`
  | ForeignPublications<Modules, Packages>
  | Named<"module id", Duplicate<Ids<Modules>>>
  | Named<"page key", Duplicate<Collect<Modules, "pages">>>
  | Named<"route path", Duplicate<Collect<Modules, "paths">>>
  | Named<"drawer name", Duplicate<Collect<Modules, "drawers">>>
  | Named<"surface publication", Duplicate<Collect<Modules, "publishes">>>
  | `unpublished surface "${Exclude<Collect<Modules, "mounts">[number], Collect<Modules, "publishes">[number]>}"`;

type Diagnostic<Keys extends string> = Simplify<{ readonly [Key in Keys]: never }>;
export type BrowserComposition<
  Modules extends readonly BrowserDeclaration[],
  Packages extends Readonly<Record<string, string>>,
> = {
  readonly render: [Widened<Modules>] extends [never]
    ? [Problems<Modules, Packages>] extends [never]
      ? () => void
      : Diagnostic<Problems<Modules, Packages>>
    : Diagnostic<Widened<Modules>>;
};

export declare function withModules<
  const Packages extends Readonly<Record<string, string>>,
  const Modules extends readonly BrowserDeclaration[],
>(packages: Packages, modules: Modules): BrowserComposition<Modules, Packages>;
