import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/*
 * The page is prerendered by build.py. These tests guard the property that makes
 * that worth doing: the content is real HTML, present for a crawler and for a
 * reader with JavaScript disabled, and the numbers shown agree with the markup.
 *
 * An earlier version of this page built every card in JavaScript. It served 858
 * characters of text to a crawler and rendered nothing at all with JS off. These
 * tests exist so that cannot come back unnoticed.
 */

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const data = JSON.parse(
  readFileSync(new URL("../data.js", import.meta.url), "utf8")
    .replace(/^window\.SKILLDATA=/, "")
    .replace(/;\s*$/, "")
);

test.describe("prerendered content", () => {
  test("every card is in the shipped HTML, not created by script", () => {
    const cards = html.match(/<article class="card">/g) || [];
    expect(cards.length).toBe(data.total);
    expect(cards.length).toBeGreaterThan(400);

    // app.js must never create content; it only attaches motion.
    const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
    expect(app).not.toMatch(/createElement\(\s*["'](?:article|section|h2|h3)["']/);
  });

  test("renders fully with JavaScript disabled", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto("/index.html");

    await expect(page.locator(".card")).toHaveCount(data.total);
    await expect(page.locator(".chapter")).toHaveCount(data.categories);

    // Substantive text, not just a shell. The JS-built version scored 858.
    const text = await page.innerText("body");
    expect(text.length).toBeGreaterThan(20000);

    // Every card must carry its description, source and licence with JS off.
    const first = page.locator(".card").first();
    await expect(first.locator("h3")).not.toBeEmpty();
    await expect(first.locator("p")).not.toBeEmpty();
    await expect(first.locator("footer a")).not.toBeEmpty();
    await ctx.close();
  });

  test("counts on screen agree with the markup", async ({ page }) => {
    await page.goto("/index.html");

    const chapters = page.locator(".chapter");
    await expect(chapters).toHaveCount(data.categories);
    await expect(page.locator("#rail a")).toHaveCount(data.categories);

    // Each chapter's declared tally must equal the cards it actually contains,
    // and data-before must be the running total before it.
    const rows = await chapters.evaluateAll((sections) =>
      sections.map((s) => ({
        id: s.id,
        declared: Number(s.getAttribute("data-count")),
        before: Number(s.getAttribute("data-before")),
        actual: s.querySelectorAll(".card").length,
        tally: Number(s.querySelector(".chapter__tally b")?.textContent ?? -1)
      }))
    );

    let running = 0;
    for (const r of rows) {
      expect(r.actual, `${r.id} card count`).toBe(r.declared);
      expect(r.tally, `${r.id} visible tally`).toBe(r.declared);
      expect(r.before, `${r.id} running offset`).toBe(running);
      running += r.declared;
    }
    expect(running).toBe(data.total);

    // The headline claim must match too.
    const h1 = (await page.locator(".hero h1").innerText()).replace(/\s+/g, " ");
    expect(h1).toContain(String(data.total));
    expect(h1).toContain(String(data.categories));
  });

  test("every rail link resolves to a real chapter", async ({ page }) => {
    await page.goto("/index.html");
    const hrefs = await page.locator("#rail a").evaluateAll((as) =>
      as.map((a) => a.getAttribute("href"))
    );
    for (const href of hrefs) {
      expect(href).toMatch(/^#cat-/);
      await expect(page.locator(href), `target for ${href}`).toHaveCount(1);
    }
  });

  test("attribution is present and licence-bearing", async ({ page }) => {
    await page.goto("/index.html");

    // Each source repo is credited with a licence and a resolvable link.
    const credits = page.locator("#credits > div");
    expect(await credits.count()).toBeGreaterThanOrEqual(3);
    for (const row of await credits.all()) {
      await expect(row.locator("strong a")).toHaveAttribute("href", /^https:\/\/github\.com\//);
      await expect(row.locator(".lic")).not.toBeEmpty();
    }

    // No card may ship without naming its licence.
    const missing = await page.locator(".card").evaluateAll((cards) =>
      cards
        .filter((c) => !(c.querySelector("footer .lic")?.textContent ?? "").trim())
        .map((c) => c.querySelector("h3")?.textContent)
    );
    expect(missing, "cards with no licence").toEqual([]);
  });

  test("no placeholder or lorem text survived", () => {
    expect(html).not.toMatch(/lorem ipsum/i);
    expect(html).not.toMatch(/TODO|FIXME|XXX|PLACEHOLDER/);
    expect(html).not.toMatch(/undefined|NaN|\[object Object\]/);
  });
});
