#!/usr/bin/env node
/*
 * Fails the build if anything that looks like a credential is committed.
 *
 * This repository deploys to Cloudflare and reads Route 53, so it is exactly the
 * kind of repo where a token gets pasted "just to test it". Everything must come
 * from GitHub Actions secrets or OIDC at run time, never from the tree.
 *
 * Deliberately conservative: it looks for provider-shaped material and for
 * assignments to secret-shaped names, and it treats `${{ secrets.X }}` and
 * documented placeholders as fine.
 *
 * Exit 0 clean, exit 1 on a finding.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SKIP_DIRS = new Set([
  ".git", "node_modules", "test-results", "playwright-report", "dist", ".venv"
]);
const SKIP_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".woff", ".woff2", ".mp4", ".pdf"]);

const RULES = [
  { id: "aws-access-key-id",  re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: "aws-secret-key",     re: /aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}/i },
  { id: "github-token",       re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  // Cloudflare API tokens are 40 chars of [A-Za-z0-9_-]; only flag one that
  // appears on a line that also mentions Cloudflare, to keep false positives down.
  { id: "cloudflare-token",   re: /cloudflare[^\n]{0,60}['"=:\s][A-Za-z0-9_-]{40}\b/i },
  { id: "google-api-key",     re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "slack-token",        re: /\bxox[abprs]-[0-9A-Za-z-]{10,}/ },
  { id: "openai-key",         re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { id: "private-key-block",  re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: "jwt",                re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./ },
  {
    id: "hardcoded-secret-assignment",
    // token: "actual-value" — but not `${{ secrets.X }}`, env refs, or placeholders.
    re: /\b(?:api[_-]?key|api[_-]?token|secret|password|passwd|access[_-]?token|auth[_-]?token|account[_-]?id|hosted[_-]?zone[_-]?id)\s*[:=]\s*['"][^'"\n]{12,}['"]/i
  }
];

// Things that are references or documentation, not credentials.
const ALLOW = [
  /\$\{\{\s*secrets\./,
  /\$\{\{\s*vars\./,
  /process\.env\./,
  /os\.environ/,
  /\bYOUR_[A-Z_]+\b/,
  /\b(?:xxx+|placeholder|example|redacted|changeme|<[a-z-]+>)\b/i,
  /secrets\.[A-Z_]+/,
  /^\s*(?:#|\/\/|\*)/          // a comment line explaining the convention
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (!SKIP_EXT.has(extname(name)) && st.size < 2_000_000) out.push(p);
  }
  return out;
}

const findings = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file);
  // This file necessarily contains the patterns it searches for.
  if (rel === "scripts/check-secrets.mjs") continue;

  let lines;
  try {
    lines = readFileSync(file, "utf8").split("\n");
  } catch {
    continue;
  }
  lines.forEach((line, i) => {
    if (line.length > 1000) return;
    if (ALLOW.some((a) => a.test(line))) return;
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        findings.push({ file: rel, line: i + 1, rule: rule.id, text: line.trim().slice(0, 100) });
      }
    }
  });
}

if (findings.length) {
  console.error(`\nSecret scan FAILED: ${findings.length} finding(s).\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.rule}]`);
    console.error(`    ${f.text}\n`);
  }
  console.error("Credentials must come from GitHub Actions secrets or OIDC, never from the tree.\n");
  process.exit(1);
}
console.log("Secret scan clean: no credential-shaped material in the tree.");
