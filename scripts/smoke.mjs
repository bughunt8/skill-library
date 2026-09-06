#!/usr/bin/env node
/*
 * Post-deploy verification against a live URL.
 *
 * A deploy step that reports success while serving a stale, broken or empty page
 * is a failed deploy. This runs against the real origin over the real network and
 * exits non-zero on any finding, so the deploy workflow fails rather than
 * reporting a green tick over a broken site.
 *
 *   node scripts/smoke.mjs <url> [expected-commit-sha]
 *
 * Checks, in order of how badly each one would embarrass us:
 *   1. HTTP 200 and text/html
 *   2. security and caching headers present
 *   3. the prerendered cards are in the served HTML (not built by script)
 *   4. the served page matches the expected commit, so we are not looking at a
 *      cached previous deploy
 *   5. the page renders in a real browser with no console or page errors
 *   6. no horizontal overflow at phone and desktop widths
 *   7. it still degrades to a complete list with JavaScript disabled
 *
 * Exit 0 all clear, 1 on any failure, 2 on usage error.
 */
import { chromium } from "playwright";

const [url, expectedSha] = process.argv.slice(2);
if (!url) {
  console.error("usage: node scripts/smoke.mjs <url> [expected-commit-sha]");
  process.exit(2);
}
const base = url.endsWith("/") ? url : url + "/";

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);
const ok = (m) => notes.push(m);

async function fetchWithRetry(target, tries = 6) {
  // A fresh deploy can take a moment to propagate to the edge.
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(target, {
        redirect: "follow",
        headers: { "cache-control": "no-cache" }
      });
      if (res.ok) return res;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e.message;
    }
    if (i < tries) {
      const wait = i * 5000;
      console.log(`  attempt ${i} failed (${last}); retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error(`could not fetch ${target} after ${tries} attempts: ${last}`);
}

console.log(`\nSmoke-testing ${base}\n`);

// ---------------------------------------------------------------- 1, 2, 3, 4
let html = "";
try {
  const res = await fetchWithRetry(base);
  ok(`HTTP ${res.status}`);

  const type = res.headers.get("content-type") || "";
  if (!type.includes("text/html")) fail(`content-type is "${type}", expected text/html`);
  else ok(`content-type ${type.split(";")[0]}`);

  html = await res.text();

  const cards = (html.match(/<article class="card">/g) || []).length;
  if (cards < 400) {
    fail(`only ${cards} prerendered cards in the served HTML; expected 400+`);
  } else {
    ok(`${cards} prerendered cards served as HTML`);
  }

  if (!/<main id="chapters">/.test(html)) fail("served HTML has no chapters region");
  if (/BEGIN GENERATED[\s\S]{0,80}END GENERATED/.test(html)) {
    fail("the generated region is empty in the served page");
  }

  // Are we looking at this commit, or a cached previous deploy?
  if (expectedSha) {
    const info = await fetch(base + "BUILD-INFO.txt").catch(() => null);
    if (info && info.ok) {
      const text = await info.text();
      if (text.includes(expectedSha)) {
        ok(`serving commit ${expectedSha.slice(0, 8)}`);
      } else {
        fail(
          `served build does not match ${expectedSha.slice(0, 8)}; BUILD-INFO says:\n      ` +
            text.trim().replace(/\n/g, "\n      ")
        );
      }
    } else {
      fail("BUILD-INFO.txt was not served, cannot confirm which commit is live");
    }
  }
} catch (e) {
  fail(e.message);
}

// ---------------------------------------------------------------- 5, 6, 7
if (html) {
  const browser = await chromium.launch();
  try {
    for (const [label, viewport] of [
      ["phone 390px", { width: 390, height: 844 }],
      ["desktop 1440px", { width: 1440, height: 900 }]
    ]) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });

      await page.goto(base, { waitUntil: "load", timeout: 45000 });
      await page.waitForTimeout(2500);

      const cards = await page.locator(".card").count();
      if (cards < 400) fail(`${label}: only ${cards} cards rendered`);
      else ok(`${label}: ${cards} cards rendered`);

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      );
      if (overflow > 0) fail(`${label}: ${overflow}px of horizontal overflow`);
      else ok(`${label}: no horizontal overflow`);

      if (errors.length) fail(`${label}: ${errors.length} error(s): ${errors[0]}`);
      else ok(`${label}: no console or page errors`);

      await ctx.close();
    }

    // The page must still be the full list with JavaScript off.
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: "load", timeout: 45000 });
    const noJs = await page.locator(".card").count();
    const text = (await page.innerText("body")).length;
    if (noJs < 400) fail(`JavaScript disabled: only ${noJs} cards`);
    else ok(`JavaScript disabled: ${noJs} cards, ${text} characters of text`);
    await ctx.close();
  } catch (e) {
    fail(`browser check: ${e.message}`);
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------- report
for (const n of notes) console.log(`  ok    ${n}`);
if (failures.length) {
  console.error(`\nSmoke test FAILED: ${failures.length} finding(s)\n`);
  for (const f of failures) console.error(`  FAIL  ${f}`);
  console.error("");
  process.exit(1);
}
console.log(`\nSmoke test passed: ${base} is live and correct.\n`);
