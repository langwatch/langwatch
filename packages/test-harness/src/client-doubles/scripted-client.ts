type ScriptedMember<Member> = Member extends (...args: infer Args) => unknown
  ? (...args: Args) => unknown
  : Member extends object
    ? ClientScript<Member>
    : Member;

/**
 * The members a test scripts on a raw client: any depth, any subset. Arguments
 * keep the client's types; answers are whatever the test says the server said.
 */
export type ClientScript<Client> = { readonly [Key in keyof Client]?: ScriptedMember<Client[Key]> };

/** A real client, never connected, answering only what the test scripted. */
export function scriptedClient<Client extends object>({
  client,
  script,
  name,
}: {
  client: Client;
  script: ClientScript<Client>;
  name: string;
}): Client {
  return new Proxy(client, scriptedHandler({ script, path: name }));
}

function scriptedHandler<Target extends object>({
  script,
  path,
}: {
  script: object;
  path: string;
}): ProxyHandler<Target> {
  return {
    get(target, property) {
      const pinned = Reflect.getOwnPropertyDescriptor(target, property);
      if (pinned?.configurable === false && pinned.writable === false) return pinned.value;
      if (typeof property === "symbol" || property in Object.prototype) {
        return Reflect.get(target, property);
      }
      const memberPath = `${path}.${property}`;
      const real: unknown = Reflect.get(target, property);
      if (Object.hasOwn(script, property)) {
        return scriptedMember({ real, scripted: Reflect.get(script, property), path: memberPath });
      }
      return unscriptedMember({ real, path: memberPath });
    },
  };
}

function scriptedMember({
  real,
  scripted,
  path,
}: {
  real: unknown;
  scripted: unknown;
  path: string;
}): unknown {
  if (!isPlainObject(scripted)) return scripted;
  const target = isObject(real) ? real : scripted;
  return new Proxy(target, scriptedHandler({ script: scripted, path }));
}

function unscriptedMember({ real, path }: { real: unknown; path: string }): unknown {
  if (real === undefined) return undefined;
  if (typeof real === "function") {
    return () => {
      throw new Error(`${path} is not scripted`);
    };
  }
  if (isObject(real)) return new Proxy(real, scriptedHandler({ script: {}, path }));
  throw new Error(`${path} is not scripted`);
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isPlainObject(value: unknown): value is object {
  if (!isObject(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
