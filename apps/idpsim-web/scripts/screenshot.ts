/**
 * Screenshots every console view. Build the bundle, start idpsim (it serves the
 * bundle), seed it through /api, then run this with the simulator's base URL.
 * PNGs land in `.claude/tmp/screens/idpsim-web/` at the repository root.
 */
import { resolve } from "node:path";

import { captureScreens, type ScreenView } from "@langwatch/design-system-internal/screenshot";
import { z } from "zod";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5565";
const outDir = resolve(import.meta.dirname, "../../../.claude/tmp/screens/idpsim-web");

// A refused sign-in needs a registered client sent somewhere it did not register.
const tenantTwo = z
  .object({ applications: z.array(z.object({ clientId: z.string() })).nullable() })
  .parse(await (await fetch(new URL("/api/t/2", baseUrl))).json());
const registered = tenantTwo.applications?.[0]?.clientId ?? "unregistered";
const authorize = ({ tenant, client }: { tenant: number; client: string }) =>
  `/t/${tenant}/oauth/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: client,
    redirect_uri: "https://elsewhere.example/cb",
  }).toString()}`;

const waitFor =
  ({ text }: { text: string }): ScreenView["prepare"] =>
  async ({ page }) => {
    await page.getByText(text, { exact: false }).first().waitFor();
  };

const views: ScreenView[] = [
  { name: "landing", path: "/", prepare: waitFor({ text: "acme1.test" }) },
  {
    name: "landing-control-api",
    path: "/",
    prepare: async ({ page }) => {
      await page.getByRole("button", { name: "Show requests" }).click();
    },
  },
  {
    name: "tenant-setup",
    path: "/t/1/#setup",
    prepare: waitFor({ text: "Registered applications" }),
  },
  {
    name: "tenant-provisioning",
    path: "/t/1/#provisioning",
    prepare: waitFor({ text: "Directory at scale" }),
  },
  {
    name: "tenant-provisioning-unconnected",
    path: "/t/2/#provisioning",
    prepare: waitFor({ text: "Connect" }),
  },
  { name: "tenant-domain", path: "/t/1/#domain", prepare: waitFor({ text: "Publish the record" }) },
  { name: "tenant-users", path: "/t/1/#users", prepare: waitFor({ text: "admin@acme1.test" }) },
  { name: "tenant-activity", path: "/t/1/#activity", prepare: waitFor({ text: "events ·" }) },
  {
    name: "tenant-refusal",
    path: "/t/2/#domain",
    prepare: async ({ page }) => {
      await page.getByRole("textbox", { name: "Name" }).fill("acme2.test");
      await page.getByRole("textbox", { name: "Value" }).fill("_langwatch-verification.acme2.test");
      await page.getByRole("button", { name: "Publish the record" }).click();
      await page.getByText("That is the record's name, not its value").waitFor();
    },
  },
  {
    name: "tenant-focus",
    path: "/t/2/#setup",
    viewportOnly: true,
    prepare: async ({ page }) => {
      await page.getByRole("textbox", { name: "Name" }).focus();
      await page.keyboard.press("Tab");
    },
  },
  { name: "tenant-missing", path: "/t/9/", prepare: waitFor({ text: "There is no tenant 9" }) },
  {
    name: "sign-in",
    path: authorize({ tenant: 1, client: "any-client" }),
    prepare: waitFor({ text: "admin@acme1.test" }),
  },
  {
    name: "sign-in-refused",
    path: authorize({ tenant: 2, client: registered }),
    prepare: waitFor({ text: "not registered" }),
  },
  {
    name: "not-found",
    path: "/nothing/here",
    prepare: waitFor({ text: "no page at this address" }),
  },
];

const written = await captureScreens({ baseUrl, views, outDir });
process.stdout.write(`${written.length} screenshots in ${outDir}\n`);
