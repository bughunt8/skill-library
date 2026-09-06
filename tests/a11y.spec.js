import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/*
 * A page that is mostly motion is easy to make unusable by keyboard or screen
 * reader. These are gates, not advice: a violation fails the build.
 */

test.describe("accessibility", () => {
  test("no axe violations at WCAG 2.1 AA", async ({ page }) => {
    await page.goto("/index.html");
    await page.waitForTimeout(2000);

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      // The ghost wordmark and mosaic are aria-hidden decoration; their contrast
      // is deliberately far below AA and they carry no information.
      .exclude(".chapter__ghost")
      .exclude(".mosaic")
      .analyze();

    const summary = violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      help: v.help
    }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });

  test("reduced-motion variant is also clean", async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce"
    });
    const page = await ctx.newPage();
    await page.goto("/index.html");
    await page.waitForTimeout(1400);

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .exclude(".chapter__ghost")
      .exclude(".mosaic")
      .analyze();

    expect(
      violations.map((v) => v.id),
      JSON.stringify(violations.map((v) => ({ id: v.id, help: v.help })), null, 2)
    ).toEqual([]);
    await ctx.close();
  });

  test("the skip link works and every category is keyboard reachable", async ({ page }) => {
    await page.goto("/index.html");
    await page.waitForTimeout(1800);

    // First tab stop must be the skip link, and it must go somewhere real.
    await page.keyboard.press("Tab");
    const first = await page.evaluate(() => ({
      cls: document.activeElement.className,
      href: document.activeElement.getAttribute("href")
    }));
    expect(first.cls).toContain("skip");
    await expect(page.locator(first.href)).toHaveCount(1);

    // Rail links are real anchors, so they are reachable and focusable.
    const focusable = await page.locator("#rail a").evaluateAll((as) =>
      as.every((a) => a.tabIndex >= 0 && a.getAttribute("href"))
    );
    expect(focusable).toBe(true);
  });

  test("document structure is landmarked and headed correctly", async ({ page }) => {
    await page.goto("/index.html");

    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("nav[aria-label]")).toHaveCount(1);
    expect(await page.getAttribute("html", "lang")).toBe("en");

    // Each chapter is a labelled region, so a screen reader can navigate them.
    const labelled = await page.locator(".chapter").evaluateAll((els) =>
      els.every((e) => {
        const id = e.getAttribute("aria-labelledby");
        return id && e.ownerDocument.getElementById(id);
      })
    );
    expect(labelled).toBe(true);
  });

  test("focusing a rail target does not leave the reader stranded", async ({ page }) => {
    await page.goto("/index.html");
    await page.waitForTimeout(2000);

    // The rail is hidden below 860px, where it would eat a phone screen, so
    // there is nothing to click. Skip rather than time out for 30 seconds.
    test.skip(
      !(await page.locator("#rail").isVisible()),
      "no category rail at this width"
    );

    const href = await page.locator("#rail a").nth(3).getAttribute("href");
    await page.locator(`#rail a[href="${href}"]`).click();
    await page.waitForTimeout(1500);

    // The chapter heading must be on screen after navigating to it.
    const visible = await page.locator(`${href} .chapter__name`).isVisible();
    expect(visible).toBe(true);
  });
});
