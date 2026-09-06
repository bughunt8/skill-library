import { test, expect } from "@playwright/test";

/*
 * The page must degrade to a plain, complete list rather than to a broken one.
 * Two failures found by hand are pinned here:
 *   1. With prefers-reduced-motion set, the decorative ghost wordmark
 *      (white-space: nowrap at 176px) had nothing containing it once pinning was
 *      off, and overflowed the document by 582px.
 *   2. Cards left at 0.3 opacity by the reduced-motion path would have been
 *      unreadable, so opacity is asserted, not assumed.
 */

const WIDTHS = [320, 375, 390, 768, 1024, 1280, 1440, 1920];

test.describe("no horizontal overflow at any width", () => {
  for (const width of WIDTHS) {
    for (const reducedMotion of ["no-preference", "reduce"]) {
      test(`${width}px, motion=${reducedMotion}`, async ({ browser }) => {
        const ctx = await browser.newContext({
          viewport: { width, height: 860 },
          reducedMotion
        });
        const page = await ctx.newPage();
        await page.goto("/index.html");
        await page.waitForTimeout(1600);

        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
        );
        expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(0);

        // Nothing may stick out sideways, decorative or not.
        const wide = await page.evaluate(() => {
          const w = document.documentElement.clientWidth;
          return [...document.querySelectorAll("body *")]
            .filter((el) => {
              const b = el.getBoundingClientRect();
              return b.width > 0 && (b.right > w + 1 || b.left < -1);
            })
            .map((el) => el.className || el.tagName)
            .slice(0, 5);
        });
        expect(wide, `elements past the viewport at ${width}px`).toEqual([]);
        await ctx.close();
      });
    }
  }
});

test.describe("prefers-reduced-motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("becomes a static, complete, readable list", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/index.html");
    await page.waitForTimeout(1600);

    // No pinning at all.
    expect(await page.locator(".pin-spacer").count()).toBe(0);
    await expect(page.locator("html")).not.toHaveClass(/is-enhanced/);

    // Every card fully opaque and untransformed, so nothing is hidden.
    const hidden = await page.locator(".card").evaluateAll((cards) =>
      cards.filter((c) => Number(getComputedStyle(c).opacity) < 0.95).length
    );
    expect(hidden).toBe(0);

    // The decorative ghost is removed rather than left to overflow.
    const ghosts = await page.locator(".chapter__ghost").evaluateAll((els) =>
      els.filter((e) => getComputedStyle(e).display !== "none").length
    );
    expect(ghosts).toBe(0);

    expect(errors).toEqual([]);
  });

  test("the counter is truthful instead of stuck at zero", async ({ page }) => {
    await page.goto("/index.html");
    await page.waitForTimeout(1200);
    const n = await page.evaluate(
      () => Number(document.querySelector("#hudcount b")?.textContent ?? -1)
    );
    const total = await page.evaluate(() => window.SKILLDATA.total);
    expect(n).toBe(total);
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("swaps pinning for native swipe", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/index.html");
    await page.waitForTimeout(1600);

    // Pinning a horizontal strip inside a touch-scrolled page fights the user,
    // so the strip becomes a native scroll-snap carousel instead.
    expect(await page.locator(".pin-spacer").count()).toBe(0);
    const strip = await page.evaluate(() => {
      const s = document.querySelector(".strip");
      const cs = getComputedStyle(s);
      return { overflowX: cs.overflowX, snap: cs.scrollSnapType };
    });
    expect(["auto", "scroll"]).toContain(strip.overflowX);
    expect(strip.snap).toMatch(/x/);

    // The fixed rail would eat the screen on a phone.
    await expect(page.locator("#rail")).toBeHidden();

    // A card can actually be swiped to.
    const moved = await page.evaluate(async () => {
      const s = document.querySelector(".strip");
      const before = s.scrollLeft;
      s.scrollLeft = before + 600;
      await new Promise((r) => setTimeout(r, 250));
      return s.scrollLeft > before;
    });
    expect(moved).toBe(true);

    expect(errors).toEqual([]);
  });
});

test.describe("graceful failure", () => {
  test("survives the motion CDN being unavailable", async ({ page }) => {
    // If jsDelivr is blocked or down, the page must still be the full list.
    await page.route("**/cdn.jsdelivr.net/**", (r) => r.abort());

    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/index.html");
    await page.waitForTimeout(1600);

    const total = await page.evaluate(() => window.SKILLDATA.total);
    await expect(page.locator(".card")).toHaveCount(total);
    await expect(page.locator("html")).not.toHaveClass(/is-enhanced/);
    expect(errors, "must bail out quietly, not throw").toEqual([]);
  });
});
