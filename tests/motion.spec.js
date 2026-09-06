import { test, expect } from "@playwright/test";

/*
 * The motion layer is the point of this page, so it is tested as behaviour
 * rather than as the presence of a library.
 *
 * Two real defects found by hand during the build are pinned here as
 * regressions, because both produced a page that still "worked":
 *   1. The filmstrip was tweened to +travel instead of -travel, so cards moved
 *      right and off screen instead of left through the frame.
 *   2. The strip was clipped by padding rather than by the mask, so travelling
 *      cards slid underneath the fixed category rail.
 */

test.describe("scroll choreography", () => {
  test.skip(({ browserName, isMobile }) => isMobile, "desktop pinning only");

  test("loads with no console or page errors", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await page.goto("/index.html");
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollTo(0, 4200));
    await page.waitForTimeout(1500);

    expect(errors).toEqual([]);
  });

  test("motion actually attaches", async ({ page }) => {
    await page.goto("/index.html");
    await page.waitForTimeout(2500);

    // The script marks the document once it has taken over.
    await expect(page.locator("html")).toHaveClass(/is-enhanced/);

    const triggers = await page.evaluate(
      () => window.ScrollTrigger.getAll().length
    );
    // One per chapter plus the hero.
    expect(triggers).toBeGreaterThanOrEqual(20);

    // Pinning is what makes a chapter a chapter.
    expect(await page.locator(".pin-spacer").count()).toBeGreaterThan(0);
  });

  test("the filmstrip travels left, so card 1 leads", async ({ page }) => {
    await page.goto("/index.html");
    await page.waitForTimeout(2500);

    const xAt = async (y) => {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(1400);
      return page.evaluate(() => {
        const live = document.querySelector(".chapter.is-live .strip");
        if (!live) return null;
        return new DOMMatrixReadOnly(getComputedStyle(live).transform).m41;
      });
    };

    const early = await xAt(2500);
    const later = await xAt(6000);

    expect(early).not.toBeNull();
    expect(later).not.toBeNull();
    // Regression guard for the sign bug: x must decrease, never increase.
    expect(later).toBeLessThan(early);
    expect(later).toBeLessThanOrEqual(0);
  });

  test("cards never slide under the category rail", async ({ page }) => {
    await page.goto("/index.html");
    await page.waitForTimeout(2500);

    for (const y of [2500, 4200, 6000, 7600]) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(1200);

      const r = await page.evaluate(() => {
        const rail = document.querySelector("#rail");
        if (!rail || getComputedStyle(rail).display === "none") return null;
        const railBox = rail.getBoundingClientRect();
        const masks = [...document.querySelectorAll(".strip__mask")].map((m) =>
          m.getBoundingClientRect()
        );
        // Only cards inside the viewport can overlap anything visible.
        const bad = [...document.querySelectorAll(".card")]
          .map((c) => c.getBoundingClientRect())
          .filter(
            (b) =>
              b.right > 0 &&
              b.left < window.innerWidth &&
              b.bottom > 0 &&
              b.top < window.innerHeight &&
              b.right > railBox.left + 1
          ).length;
        return { bad, clipped: masks.every((m) => m.right <= railBox.left + 1) };
      });

      if (r === null) continue;
      expect(r.clipped, `mask clips before rail at ${y}px`).toBe(true);
      expect(r.bad, `cards overlapping rail at ${y}px`).toBe(0);
    }
  });

  test("cards stay readable rather than fading to near-invisible", async ({ page }) => {
    await page.goto("/index.html");
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollTo(0, 4200));
    await page.waitForTimeout(1400);

    const min = await page.evaluate(() => {
      const vis = [...document.querySelectorAll(".card")].filter((c) => {
        const b = c.getBoundingClientRect();
        return (
          b.right > 0 &&
          b.left < window.innerWidth &&
          b.bottom > 0 &&
          b.top < window.innerHeight
        );
      });
      return vis.length
        ? Math.min(...vis.map((c) => Number(getComputedStyle(c).opacity)))
        : 1;
    });
    // 0.3 read as empty space against this background.
    expect(min).toBeGreaterThanOrEqual(0.6);
  });

  test("the counter advances and the category label follows the scroll", async ({ page }) => {
    await page.goto("/index.html");
    await page.waitForTimeout(2500);

    const read = async (y) => {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(1400);
      return page.evaluate(() => ({
        hud: document.getElementById("hudcount").textContent.trim(),
        n: Number(document.querySelector("#hudcount b")?.textContent ?? -1),
        here: document.querySelector("#rail a.is-here")?.textContent ?? null
      }));
    };

    const a = await read(3000);
    const b = await read(9000);

    expect(a.n).toBeGreaterThanOrEqual(0);
    expect(b.n).toBeGreaterThan(a.n);
    expect(b.here).not.toBeNull();
    // The HUD names the category you are travelling through.
    expect(b.hud).toMatch(/\S/);
  });

  test("the page is long enough for the choreography to breathe", async ({ page }) => {
    await page.goto("/index.html");
    await page.waitForTimeout(2500);
    const vh = await page.evaluate(
      () => document.body.scrollHeight / window.innerHeight
    );
    // Pinned chapters must add real scroll length, not collapse into a list.
    expect(vh).toBeGreaterThan(30);
  });
});
