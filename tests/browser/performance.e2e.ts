import { expect, test, type Page } from "@playwright/test";
const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://cdn.discordapp.com/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="gray"/></svg>' }));
  await page.goto("/tests/browser/fixture.html");
  await expect(page.getByRole("textbox", { name: "Mensagem", exact: true })).toBeVisible();
});

test.afterEach(async ({ page }) => { expect(browserErrors.get(page)).toEqual([]); });

test("a thousand messages retain a bounded DOM and keep reading position", async ({ page }) => {
  await expect(page.getByText("Message 1000", { exact: true })).toBeVisible();
  expect(await page.locator("[data-message-row]").count()).toBeLessThan(80);
  const scroll = page.locator('[data-virtual-message-list] div[style*="overflow: auto"]');
  await scroll.evaluate((node) => { node.scrollTop = node.scrollHeight / 2; });
  await page.waitForTimeout(250);
  const before = await page.locator("[data-message-row]").evaluateAll((nodes) => nodes.filter((node) => {
    const bounds = node.getBoundingClientRect(); return bounds.top > 100 && bounds.top < 450;
  }).map((node) => ({ id: node.getAttribute("data-message-row"), top: node.getBoundingClientRect().top })));
  await page.evaluate(() => (window as any).__fixture.append());
  await page.waitForTimeout(250);
  const anchor = before[0];
  expect(anchor).toBeTruthy();
  const after = await page.locator(`[data-message-row="${anchor.id}"]`).evaluate((node) => node.getBoundingClientRect().top);
  expect(Math.abs(after - anchor.top)).toBeLessThan(6);
  await page.evaluate(() => (window as any).__fixture.appearance("compact", 20));
  await page.waitForTimeout(250);
  expect(await page.locator("[data-message-row]").count()).toBeLessThan(80);
  await expect(page.locator(`[data-message-row="${anchor.id}"]`)).toBeAttached();
});

test("custom emoji typing, suggestions and outgoing code still work", async ({ page }) => {
  const editor = page.getByRole("textbox", { name: "Mensagem", exact: true });
  await editor.pressSequentially(":wav");
  await expect(page.getByRole("listbox", { name: "Sugestões de emoji" })).toBeVisible();
  await editor.press("Tab");
  await expect(editor.locator("img")).toHaveCount(1);
  await editor.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.state().sent)).toEqual(["<:wave:123456789012345678>"]);
});

test("preview URLs are reused while typing and released on navigation", async ({ page }) => {
  await page.evaluate(() => (window as any).__fixture.attach());
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.state().urls)).toBe(1);
  await page.getByRole("textbox", { name: "Mensagem", exact: true }).pressSequentially("typing does not allocate more URLs");
  expect(await page.evaluate(() => (window as any).__fixture.state().urls)).toBe(1);
  await page.getByRole("button", { name: "Trocar conversa" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.state().urls)).toBe(0);
});

test("navigation releases recording resources and late microphone permission", async ({ page }) => {
  await page.getByTitle("Gravar mensagem de voz", { exact: true }).click();
  await expect(page.getByTitle("Cancelar áudio", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Trocar conversa" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.state().tracksStopped)).toBe(1);
  expect(await page.evaluate(() => (window as any).__fixture.state().contextsClosed)).toBe(1);
  await page.evaluate(() => (window as any).__fixture.delayedPermission());
  await page.getByTitle("Gravar mensagem de voz", { exact: true }).click();
  await page.getByRole("button", { name: "Trocar conversa" }).click();
  await page.evaluate(() => (window as any).__fixture.grant());
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.state().tracksStopped)).toBe(2);
});

test("message audio keeps playing after its virtual row is unmounted", async ({ page }) => {
  await page.evaluate(() => (window as any).__fixture.voiceMessage());
  await page.getByRole("button", { name: "Reproduzir mensagem de voz" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.state().audio)).toBe(true);
  await page.locator('[data-virtual-message-list] div[style*="overflow: auto"]').evaluate((node) => { node.scrollTop = 0; });
  await expect(page.getByRole("button", { name: "Pausar mensagem de voz" })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__fixture.state().audio)).toBe(true);
});

test("a healthy connection does not poll while idle", async ({ page }) => {
  const count = () => page.evaluate(() => (window as any).__fixture.state().calls.filter((c: string) => c === "get_messages").length);
  await page.waitForTimeout(300);
  const initial = await count();
  await page.waitForTimeout(3500);
  expect(await count()).toBe(initial);
});

test("image proxy failure falls back to the original and opening keeps its URL", async ({ page }) => {
  const requests: string[] = [];
  await page.route("https://media.discordapp.net/**", (route) => {
    requests.push(route.request().url());
    return route.fulfill({ status: 404, body: "unavailable" });
  });
  await page.evaluate(() => (window as any).__fixture.imageMessage());
  const image = page.getByRole("img", { name: "large-photo.png" });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", "https://cdn.discordapp.com/attachments/a/b/photo.png?ex=expires&hm=signature");
  expect(new URL(requests[0]).searchParams.get("width")).toBeTruthy();
  expect(new URL(requests[0]).searchParams.get("hm")).toBe("signature");
  await image.click();
  expect(await page.evaluate(() => (window as any).__fixture.state().focusedImage)).toBe("https://cdn.discordapp.com/attachments/a/b/photo.png?ex=expires&hm=signature");
});

test("device settings release late microphone and camera permissions after leaving", async ({ page }) => {
  await page.getByRole("button", { name: "Testar dispositivos", exact: true }).click();
  await page.getByRole("button", { name: "Testar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Parar", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Trocar conversa" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.state().tracksStopped)).toBe(1);
  expect(await page.evaluate(() => (window as any).__fixture.state().contextsClosed)).toBe(1);
  for (const name of ["Testar", "Abrir prévia"]) {
    await page.getByRole("button", { name: "Testar dispositivos", exact: true }).click();
    await page.evaluate(() => (window as any).__fixture.delayedPermission());
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("button", { name: "Trocar conversa" }).click();
    await page.evaluate(() => (window as any).__fixture.grant());
  }
  await expect.poll(() => page.evaluate(() => (window as any).__fixture.state().tracksStopped)).toBe(3);
});
