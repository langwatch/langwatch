/**
 * What the compiler accepts for E4, E5 and E7. Specs: packages/api/specs/
 * transport-declaration-split.feature and trpc-framework.feature.
 */
import {
  defineRestRouter,
  type FeatureApiWitness,
  type RestKeyCredential,
} from "@langwatch/api/rest";
import { z } from "zod";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

interface DoorsApi {
  run(input: unknown): Promise<unknown>;
}

declare const restApi: FeatureApiWitness<DoorsApi>;

const route = () =>
  defineRestRouter(restApi)
    .withNamespace("door-questions")
    .withVersion("2026-10-05")
    .post("/run", "run");

// E4: a platform-tier permission at the platform; any other permission there is refused.
route().withPermission("ops:manage", { at: "platform", refusal: "hidden" });
// @ts-expect-error - only a platform-tier permission is granted at the platform
route().withPermission("traces:view", { at: "platform" });

// E5: a key door hands the key it resolved, typed; a door that resolves none cannot declare it.
route()
  .withCredential("project", { key: true })
  .withPermission("traces:create")
  .withOutput(z.object({}))
  .handle(({ key }) => {
    type Handed = Assert<Equal<typeof key, RestKeyCredential>>;
    const handed: Handed = true;

    return handed ? {} : {};
  });
// @ts-expect-error - the browser door resolves no key
route().withCredential("browser", { key: true });
route()
  .withCredential("project")
  .withPermission("traces:create")
  .withOutput(z.object({}))
  // @ts-expect-error - a route that did not declare the key is handed none
  .handle(({ key }) => (key ? {} : {}));

// E7: the project door admits a list of key kinds; no other door may.
route().withCredential("project", { keyKinds: ["api_key", "access_token"] });
// @ts-expect-error - only the project door tells the key kinds apart
route().withCredential("organization", { keyKinds: ["api_key"] });
// @ts-expect-error - a kind the vocabulary does not name
route().withCredential("project", { keyKinds: ["personal_key"] });
